"""The OPC UA server through a standard client: browse, read, write, every security
and sign-in choice, strict trust, renumbered node ids, the flat style and the server
scenarios."""
import asyncio
import json
import logging
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

from asyncua import Client, ua
from asyncua.crypto.cert_gen import setup_self_signed_certificate
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256
from cryptography.x509.oid import ExtendedKeyUsageOID

import bms_server
from bms.model import build, load
from bms.physics import SimpleBuilding

HERE = pathlib.Path(__file__).resolve().parent
NAMESPACE = 'urn:example:bms:example-tower'
CLIENT_URI = 'urn:example:bms:test-client'
STANDARD = build(load(), 'standard')
# The unencrypted endpoint makes asyncua warn about every password.
logging.getLogger('asyncua').setLevel(logging.CRITICAL)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class ServerTest(unittest.IsolatedAsyncioTestCase):
    options: dict = {}

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        root = pathlib.Path(cls.folder.name)
        cls.credentials = asyncio.run(bms_server.Credentials(root / 'bms-simulator.json', root / 'certificates', NAMESPACE,
                                                             'localhost').ensure())
        # A client of our own: its certificate is not the operator's.
        cls.client_certificate, cls.client_key = root / 'client-certificate.der', root / 'client-key.pem'
        asyncio.run(setup_self_signed_certificate(cls.client_key, cls.client_certificate, CLIENT_URI, 'localhost',
                                                  [ExtendedKeyUsageOID.CLIENT_AUTH], {'commonName': 'Test client'}))

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    async def asyncSetUp(self):
        asyncio.get_running_loop().slow_callback_duration = 5.0  # building the address space is one long step
        self.port = free_port()
        self.bms = bms_server.BmsServer(STANDARD, SimpleBuilding(STANDARD), self.credentials, '127.0.0.1', self.port, **self.options)
        await self.bms.start()
        self.url = f'opc.tcp://127.0.0.1:{self.port}/'

    async def asyncTearDown(self):
        await self.bms.stop()

    async def client(self, operator=False, password=None, certificate=None, encrypted=False):
        """A connected client: anonymous, the operator by password, or signed in with a
        certificate ('operator' or 'client'), over the unencrypted or encrypted endpoint."""
        client = Client(self.url, timeout=10)
        client.application_uri = CLIENT_URI
        if encrypted:
            await client.set_security(SecurityPolicyBasic256Sha256, certificate=str(self.client_certificate),
                                      private_key=str(self.client_key))
        if operator:
            client.set_user('operator')
            client.set_password(password or self.credentials.password)
        if certificate:
            cert, key = ((self.credentials.operator_certificate, self.credentials.operator_key) if certificate == 'operator'
                         else (self.client_certificate, self.client_key))
            await client.load_client_certificate(str(cert))
            await client.load_private_key(str(key))
        await client.connect()
        self.addAsyncCleanup(client.disconnect)
        return client

    async def write(self, client, point, variant):
        idx = await client.get_namespace_index(NAMESPACE)
        try:
            await client.get_node(ua.NodeId(point, idx)).write_value(ua.DataValue(variant))
        except ua.UaStatusCodeError as error:
            return type(error).__name__
        return 'Good'

    async def zone(self, client):
        idx = await client.get_namespace_index(NAMESPACE)
        return await client.nodes.objects.get_child([f'{idx}:Example Campus', f'{idx}:Example Tower', f'{idx}:L03', f'{idx}:L03-Z2', f'{idx}:L03-VAV-2'])


def double(value):
    return ua.Variant(float(value), ua.VariantType.Double)


class ReadingTest(ServerTest):
    async def test_a_client_browses_the_building_and_reads_a_zone(self):
        client = await self.client()
        idx = await client.get_namespace_index(NAMESPACE)
        tower = await client.nodes.objects.get_child([f'{idx}:Example Campus', f'{idx}:Example Tower'])
        levels = [(await n.read_display_name()).Text for n in await tower.get_children()]
        self.assertEqual(levels, ['Basement 1', 'Level 2', 'Level 3', 'Level 10', 'Roof'])
        box = await self.zone(client)
        self.assertEqual(len(await box.get_children()), 14)
        temperature = await box.get_child(f'{idx}:zone_temperature')
        value = await temperature.read_data_value()
        self.assertTrue(value.StatusCode.is_good())
        self.assertTrue(10 <= value.Value.Value <= 35)
        self.assertIn('L03-VAV-2', (await temperature.read_description()).Text)
        unit = await (await temperature.get_child('0:EngineeringUnits')).read_value()
        limits = await (await temperature.get_child('0:EURange')).read_value()
        self.assertEqual((unit.DisplayName.Text, unit.UnitId), ('°C', bms_server.unit_id('CEL')))
        self.assertEqual((limits.Low, limits.High), (10.0, 35.0))
        self.assertEqual(await temperature.read_type_definition(), ua.NodeId(ua.ObjectIds.AnalogItemType))

    async def test_named_states_and_on_off_values_carry_their_labels(self):
        client = await self.client()
        idx = await client.get_namespace_index(NAMESPACE)
        mode = client.get_node(ua.NodeId('L03-AHU-1.mode', idx))
        self.assertEqual([t.Text for t in await (await mode.get_child('0:EnumStrings')).read_value()], ['Auto', 'Off', 'On'])
        alarm = client.get_node(ua.NodeId('L03-AHU-1.filter_alarm', idx))
        self.assertEqual((await (await alarm.get_child('0:TrueState')).read_value()).Text, 'Alarm')

    async def test_a_scenario_turns_a_zone_bad_while_the_others_stay_good(self):
        client = await self.client()
        idx = await client.get_namespace_index(NAMESPACE)
        self.bms.scenarios.switch('controller_offline', True, 'L03-VAV-2')
        await self.bms.publish()
        offline = await client.get_node(ua.NodeId('L03-VAV-2.zone_temperature', idx)).read_data_value(raise_on_bad_status=False)
        other = await client.get_node(ua.NodeId('L03-VAV-3.zone_temperature', idx)).read_data_value()
        self.assertEqual(offline.StatusCode.value, ua.StatusCodes.BadNoCommunication)
        self.assertTrue(other.StatusCode.is_good())


class WritingTest(ServerTest):
    async def test_an_operator_writes_a_setpoint_and_the_zone_takes_it(self):
        client = await self.client(operator=True)
        self.assertEqual(await self.write(client, 'L03-VAV-2.temperature_setpoint', double(21)), 'Good')
        self.assertEqual(self.bms.physics.read()['L03-VAV-2.temperature_setpoint'], 21.0)
        self.assertEqual(await self.write(client, 'L03-AHU-1.mode', ua.Variant(1, ua.VariantType.UInt32)), 'Good')
        self.assertEqual(self.bms.physics.read()['L03-AHU-1.mode'], 'Off')

    async def test_out_of_range_wrong_type_and_read_only_points_are_refused(self):
        client = await self.client(operator=True)
        self.assertEqual(await self.write(client, 'L03-VAV-2.temperature_setpoint', double(40)), 'BadOutOfRange')
        self.assertEqual(await self.write(client, 'L03-VAV-2.temperature_setpoint', ua.Variant('warm', ua.VariantType.String)), 'BadTypeMismatch')
        self.assertEqual(await self.write(client, 'L03-AHU-1.mode', ua.Variant(7, ua.VariantType.UInt32)), 'BadOutOfRange')
        self.assertEqual(await self.write(client, 'L03-VAV-2.zone_temperature', double(1)), 'BadNotWritable')
        self.assertEqual(await self.write(client, 'B1-MM-1.energy_imported', double(1)), 'BadNotWritable')

    async def test_an_anonymous_session_reads_only(self):
        client = await self.client()
        self.assertEqual(await self.write(client, 'L03-VAV-2.temperature_setpoint', double(21)), 'BadUserAccessDenied')

    async def test_a_wrong_password_is_refused(self):
        with self.assertRaises(ua.UaStatusCodeError):
            await self.client(operator=True, password='not-the-password')

    async def test_values_follow_the_building(self):
        client = await self.client()
        idx = await client.get_namespace_index(NAMESPACE)
        node = client.get_node(ua.NodeId('RF-WX-1.outdoor_temperature', idx))
        before = await node.read_data_value()
        self.bms.physics.step(1800)
        await self.bms.publish()
        self.assertGreater((await node.read_data_value()).SourceTimestamp, before.SourceTimestamp)


class SignInTest(ServerTest):
    async def test_every_security_and_sign_in_choice_browses_and_reads(self):
        for encrypted in (False, True):
            for sign_in, writes in (('anonymous', 'BadUserAccessDenied'), ('password', 'Good'), ('operator certificate', 'Good'),
                                    ('client certificate', 'BadUserAccessDenied')):
                with self.subTest(encrypted=encrypted, sign_in=sign_in):
                    client = await self.client(encrypted=encrypted, operator=sign_in == 'password',
                                               certificate=sign_in.split()[0] if 'certificate' in sign_in else None)
                    value = await (await (await self.zone(client)).get_child(f'{await client.get_namespace_index(NAMESPACE)}:zone_temperature')).read_value()
                    self.assertTrue(10 <= value <= 35)
                    self.assertEqual(await self.write(client, 'L03-VAV-2.temperature_setpoint', double(22)), writes)
                    await client.disconnect()

    async def test_the_endpoints_offer_both_security_choices_and_every_sign_in(self):
        client = Client(self.url)
        endpoints = await client.connect_and_get_server_endpoints()
        policies = {e.SecurityPolicyUri.rsplit('#', 1)[1] for e in endpoints}
        tokens = {t.TokenType for e in endpoints for t in e.UserIdentityTokens}
        self.assertEqual(policies, {'None', 'Basic256Sha256'})
        self.assertEqual(tokens, {ua.UserTokenType.Anonymous, ua.UserTokenType.UserName, ua.UserTokenType.Certificate})
        der = endpoints[-1].ServerCertificate
        self.assertEqual(bms_server.fingerprint(der), self.credentials.server_fingerprint())


class EncryptedNamesOnlyTest(ServerTest):
    options = {'security': ('basic256sha256',), 'auth': ('username',)}

    async def test_switched_off_choices_are_refused(self):
        with self.assertRaises(Exception):
            await self.client()  # unencrypted
        with self.assertRaises(ua.UaStatusCodeError):
            await self.client(encrypted=True)  # anonymous
        client = await self.client(encrypted=True, operator=True)
        self.assertEqual(await self.write(client, 'L03-VAV-2.temperature_setpoint', double(22)), 'Good')


class StrictTrustTest(ServerTest):
    options = {'strict_trust': True}

    async def test_a_client_certificate_is_refused_until_it_is_trusted(self):
        with self.assertRaises(ua.UaStatusCodeError):
            await self.client(encrypted=True)
        rejected = list(self.credentials.rejected.glob('*.der'))
        self.assertEqual(len(rejected), 1)
        shutil.copy(rejected[0], self.credentials.trusted / rejected[0].name)
        self.addCleanup(lambda: (self.credentials.trusted / rejected[0].name).unlink(missing_ok=True))
        client = await self.client(encrypted=True)
        self.assertEqual(len(await (await self.zone(client)).get_children()), 14)


class RenumberTest(ServerTest):
    options = {'node_ids': 'renumber'}

    async def test_numeric_ids_change_at_each_start_while_paths_stay(self):
        async def zone_id():
            client = await self.client()
            node = await (await self.zone(client)).get_child(f'{await client.get_namespace_index(NAMESPACE)}:zone_temperature')
            await client.disconnect()
            return node.nodeid
        first = await zone_id()
        await self.bms.restart(0)
        second = await zone_id()
        self.assertIsInstance(first.Identifier, int)  # small numbers travel as the compact FourByte encoding
        self.assertNotEqual(first, second)


class FlatTest(ServerTest):
    options = {'style': 'flat'}

    async def test_one_folder_of_tags_with_the_same_points(self):
        client = await self.client(operator=True)
        idx = await client.get_namespace_index(NAMESPACE)
        folder = await client.nodes.objects.get_child(f'{idx}:ET')
        tags = await folder.get_children()
        self.assertEqual(len(tags), 706)
        tag = await folder.get_child(ua.QualifiedName('ET_L03_VAV_2.ZN-T', idx))  # a '.' in path text would split it
        self.assertTrue(10 <= await tag.read_value() <= 35)
        self.assertEqual(await self.write(client, 'ET_L03_VAV_2.T-SP', double(21)), 'Good')
        self.assertEqual(self.bms.physics.read()['L03-VAV-2.temperature_setpoint'], 21.0)


class ServerScenariosTest(ServerTest):
    async def test_a_wrong_clock_shifts_source_times(self):
        client = await self.client()
        node = client.get_node(ua.NodeId('RF-WX-1.outdoor_temperature', await client.get_namespace_index(NAMESPACE)))
        self.bms.scenarios.switch('clock_wrong', True, 600)
        await self.bms.publish()
        shifted = (await node.read_data_value()).SourceTimestamp
        self.assertAlmostEqual((shifted - self.bms.physics.now).total_seconds(), 600, delta=1)

    async def test_slow_browse_delays_browse_answers(self):
        client = await self.client()
        self.bms.scenarios.switch('slow_browse', True, 1)
        started = time.monotonic()
        await client.nodes.objects.get_children()
        self.assertGreaterEqual(time.monotonic() - started, 1.0)

    async def test_a_session_limit_refuses_a_second_session(self):
        await self.client()
        self.bms.scenarios.switch('session_limit', True)
        with self.assertRaises(Exception):
            await asyncio.wait_for(self.client(), 5)
        self.bms.scenarios.switch('session_limit', False)
        await self.client()

    async def test_a_restart_stops_the_server_for_a_while(self):
        self.bms.scenarios.switch('server_restart', True, 1)
        await asyncio.sleep(0.3)
        self.assertFalse(self.bms.started)
        with self.assertRaises(Exception):
            await asyncio.wait_for(self.client(), 2)
        for _ in range(50):
            await asyncio.sleep(0.1)
            if self.bms.started:
                break
        self.assertTrue(self.bms.started)
        await self.client()

    async def test_a_changed_certificate_is_served_after_the_restart(self):
        before = self.credentials.server_fingerprint()
        self.bms.scenarios.switch('certificate_changed', True)
        for _ in range(50):
            await asyncio.sleep(0.1)
            if self.bms.started and self.credentials.server_fingerprint() != before:
                break
        self.assertNotEqual(self.credentials.server_fingerprint(), before)
        endpoints = await Client(self.url).connect_and_get_server_endpoints()
        self.assertEqual(bms_server.fingerprint(endpoints[-1].ServerCertificate), self.credentials.server_fingerprint())


class ControlPortTest(ServerTest):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        args = bms_server.parse(['--speed', '1'])
        port = free_port()
        self.control = await bms_server.ControlPort(self.bms, args).start('127.0.0.1', port)
        self.base = f'http://127.0.0.1:{port}'

    async def asyncTearDown(self):
        self.control.close()
        await super().asyncTearDown()

    async def http(self, method, path, body=None):
        def call():
            data = json.dumps(body).encode() if body is not None else None
            request = urllib.request.Request(self.base + path, data=data, method=method)
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    raw = response.read()
                    return response.status, json.loads(raw) if response.headers['Content-Type'] == 'application/json' else raw.decode()
            except urllib.error.HTTPError as error:
                return error.code, json.loads(error.read())
        return await asyncio.to_thread(call)

    async def test_state_values_and_writes(self):
        status, state = await self.http('GET', '/state')
        self.assertEqual((status, state['size'], state['style'], state['scenarios']), (200, 'standard', 'structured', {}))
        status, body = await self.http('POST', '/write', {'point': 'L03-VAV-2.temperature_setpoint', 'value': 23})
        self.assertEqual((status, body['status']), (200, 'Good'))
        status, body = await self.http('POST', '/write', {'point': 'L03-VAV-2.temperature_setpoint', 'value': 40})
        self.assertEqual((status, body['status']), (400, 'BadOutOfRange'))
        status, body = await self.http('GET', '/values?points=L03-VAV-2.temperature_setpoint,L03-VAV-2.zone_temperature')
        self.assertEqual(body['values']['L03-VAV-2.temperature_setpoint'], {'value': 23.0, 'status': 'Good', 'unit': '°C'})
        status, _ = await self.http('GET', '/values?points=L99-VAV-1.zone_temperature')
        self.assertEqual(status, 404)

    async def test_scenarios_switch_on_and_off(self):
        status, body = await self.http('GET', '/scenarios')
        self.assertEqual((status, len(body['scenarios'])), (200, 18))
        status, body = await self.http('POST', '/scenarios/controller_offline', {'on': True})
        self.assertEqual((status, body['target']), (200, 'L03-VAV-2'))
        self.assertEqual(self.bms.physics.quality('L03-VAV-2.zone_temperature'), 'BadNoCommunication')
        status, body = await self.http('POST', '/scenarios/controller_offline', {'on': False})
        self.assertEqual((status, body['scenarios']), (200, {}))
        status, body = await self.http('POST', '/scenarios/car_park_co', {'on': True})
        self.assertEqual(status, 400)
        self.assertIn('larger size', body['error'])
        status, _ = await self.http('POST', '/scenarios/earthquake', {'on': True})
        self.assertEqual(status, 404)

    async def test_the_controls_page_is_served(self):
        status, page = await self.http('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn('<title>Example Tower controls</title>', page)


class CommandLineTest(unittest.TestCase):
    def test_export_model_prints_the_building_and_stops(self):
        result = subprocess.run([sys.executable, str(HERE / 'bms_server.py'), '--export-model', '--size', 'tower'],
                                capture_output=True, text=True, check=True, timeout=60)
        self.assertEqual(json.loads(result.stdout)['totals'], {'levels': 14, 'points': 2466, 'commands': 531, 'devices': 294})

    def test_sign_in_values_and_certificates_are_written_once_and_kept_private(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            first = asyncio.run(bms_server.Credentials(root / 'devices' / 'bms.json', root / 'certs', NAMESPACE, 'localhost').ensure())
            again = asyncio.run(bms_server.Credentials(root / 'devices' / 'bms.json', root / 'certs', NAMESPACE, 'localhost').ensure())
            self.assertEqual(first.password, again.password)
            self.assertEqual(first.server_fingerprint(), again.server_fingerprint())
            data = json.loads((root / 'devices' / 'bms.json').read_text())
            self.assertEqual(set(data['operator']), {'username', 'password', 'certificate', 'private_key'})
            self.assertEqual((root / 'devices' / 'bms.json').stat().st_mode & 0o777, 0o600)
            self.assertEqual((root / 'certs').stat().st_mode & 0o777, 0o700)


if __name__ == '__main__':
    unittest.main()
