"""The OPC UA server through a standard client: browse, read, and every kind of write.

Pull request 1b adds the encrypted endpoint, certificate sign-in, the flat naming style
and the scenarios to these checks.
"""
import asyncio
import json
import logging
import pathlib
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

from asyncua import Client, ua

import bms_server
from bms.model import build, load
from bms.physics import SimpleBuilding

HERE = pathlib.Path(__file__).resolve().parent
# The 1a server has only the unencrypted endpoint, so asyncua warns about every password.
logging.getLogger('asyncua').setLevel(logging.ERROR)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class ServerTest(unittest.IsolatedAsyncioTestCase):
    writes = True

    async def asyncSetUp(self):
        asyncio.get_running_loop().slow_callback_duration = 5.0  # building the address space is one long step
        self.folder = tempfile.TemporaryDirectory()
        secrets = pathlib.Path(self.folder.name) / 'bms-simulator.json'
        self.port, control_port = free_port(), free_port()
        args = bms_server.parse(['--port', str(self.port), '--control-port', str(control_port), '--secrets', str(secrets),
                                 '--writes', 'on' if self.writes else 'off'])
        building = build(load(), 'standard')
        self.bms = bms_server.BmsServer(building, SimpleBuilding(building), '127.0.0.1', self.port,
                                        bms_server.operator_password(secrets), self.writes)
        await self.bms.start()
        self.control = await bms_server.ControlPort(self.bms, args).start('127.0.0.1', control_port)
        self.control_url = f'http://127.0.0.1:{control_port}'
        self.password = json.loads(secrets.read_text())['operator']['password']
        self.url = f'opc.tcp://127.0.0.1:{self.port}/'

    async def asyncTearDown(self):
        self.control.close()
        await self.bms.stop()
        self.folder.cleanup()

    def client(self, operator=False, password=None):
        client = Client(self.url, timeout=10)
        if operator:
            client.set_user('operator')
            client.set_password(password or self.password)
        return client

    async def write(self, client, idx, point, variant):
        node = client.get_node(ua.NodeId(point, idx))
        try:
            await node.write_value(ua.DataValue(variant))
        except ua.UaStatusCodeError as error:
            return type(error).__name__
        return 'Good'

    async def http(self, method, path, body=None):
        def call():
            data = json.dumps(body).encode() if body is not None else None
            request = urllib.request.Request(self.control_url + path, data=data, method=method)
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                return error.code, json.loads(error.read())
        return await asyncio.to_thread(call)


class ReadingTest(ServerTest):
    async def test_a_client_browses_the_building_and_reads_a_zone(self):
        async with self.client() as client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            tower = await client.nodes.objects.get_child([f'{idx}:Example Campus', f'{idx}:Example Tower'])
            levels = [(await n.read_display_name()).Text for n in await tower.get_children()]
            self.assertEqual(levels, ['Basement 1', 'Level 2', 'Level 3', 'Level 10', 'Roof'])
            zone = await tower.get_child([f'{idx}:L03', f'{idx}:L03-Z2'])
            self.assertEqual((await zone.read_display_name()).Text, 'East')
            box = await zone.get_child(f'{idx}:L03-VAV-2')
            self.assertEqual(len(await box.get_children()), 14)
            temperature = await box.get_child(f'{idx}:zone_temperature')
            value = await temperature.read_data_value()
            self.assertTrue(value.StatusCode.is_good())
            self.assertIsNotNone(value.SourceTimestamp)
            self.assertTrue(10 <= value.Value.Value <= 35)
            self.assertEqual((await temperature.read_display_name()).Text, 'Zone temperature')
            self.assertIn('L03-VAV-2', (await temperature.read_description()).Text)
            unit = await (await temperature.get_child('0:EngineeringUnits')).read_value()
            limits = await (await temperature.get_child('0:EURange')).read_value()
            self.assertEqual(unit.DisplayName.Text, '°C')
            self.assertEqual(unit.UnitId, bms_server.unit_id('CEL'))
            self.assertEqual((limits.Low, limits.High), (10.0, 35.0))
            definition = await temperature.read_type_definition()
            self.assertEqual(definition, ua.NodeId(ua.ObjectIds.AnalogItemType))

    async def test_named_states_and_on_off_values_carry_their_labels(self):
        async with self.client() as client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            mode = client.get_node(ua.NodeId('L03-AHU-1.mode', idx))
            labels = [t.Text for t in await (await mode.get_child('0:EnumStrings')).read_value()]
            self.assertEqual(labels, ['Auto', 'Off', 'On'])
            self.assertEqual(await mode.read_value(), 0)
            alarm = client.get_node(ua.NodeId('L03-AHU-1.filter_alarm', idx))
            self.assertEqual((await (await alarm.get_child('0:TrueState')).read_value()).Text, 'Alarm')
            self.assertIs(await alarm.read_value(), False)

    async def test_plant_without_a_zone_sits_under_its_level(self):
        async with self.client() as client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            chiller = await client.nodes.objects.get_child([f'{idx}:Example Campus', f'{idx}:Example Tower', f'{idx}:L10', f'{idx}:L10-CH-1'])
            self.assertEqual(len(await chiller.get_children()), 16)


class WritingTest(ServerTest):
    async def test_an_operator_writes_a_setpoint_and_the_zone_takes_it(self):
        client = self.client(operator=True)
        async with client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            self.assertEqual(await self.write(client, idx, 'L03-VAV-2.temperature_setpoint', ua.Variant(21.0, ua.VariantType.Double)), 'Good')
            self.assertEqual(await client.get_node(ua.NodeId('L03-VAV-2.temperature_setpoint', idx)).read_value(), 21.0)
            self.assertEqual(self.bms.physics.read()['L03-VAV-2.temperature_setpoint'], 21.0)
            self.assertEqual(await self.write(client, idx, 'L03-AHU-1.mode', ua.Variant(1, ua.VariantType.UInt32)), 'Good')
            self.assertEqual(self.bms.physics.read()['L03-AHU-1.mode'], 'Off')

    async def test_a_write_outside_the_limits_or_of_the_wrong_type_is_refused(self):
        client = self.client(operator=True)
        async with client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            self.assertEqual(await self.write(client, idx, 'L03-VAV-2.temperature_setpoint', ua.Variant(40.0, ua.VariantType.Double)), 'BadOutOfRange')
            self.assertEqual(await self.write(client, idx, 'L03-VAV-2.temperature_setpoint', ua.Variant('warm', ua.VariantType.String)), 'BadTypeMismatch')
            self.assertEqual(await self.write(client, idx, 'L03-AHU-1.mode', ua.Variant(7, ua.VariantType.UInt32)), 'BadOutOfRange')
            self.assertEqual(await self.write(client, idx, 'L03-VAV-2.occupancy_override', ua.Variant(1.0, ua.VariantType.Double)), 'BadTypeMismatch')
            self.assertEqual(self.bms.physics.read()['L03-VAV-2.temperature_setpoint'], 22.5)

    async def test_sensors_statuses_and_totals_are_never_written(self):
        client = self.client(operator=True)
        async with client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            for point in ('L03-VAV-2.zone_temperature', 'L03-AHU-1.operating_state', 'B1-MM-1.energy_imported'):
                self.assertEqual(await self.write(client, idx, point, ua.Variant(1.0, ua.VariantType.Double)), 'BadNotWritable', point)

    async def test_an_anonymous_session_reads_only(self):
        async with self.client() as client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            self.assertEqual(await self.write(client, idx, 'L03-VAV-2.temperature_setpoint', ua.Variant(21.0, ua.VariantType.Double)), 'BadUserAccessDenied')

    async def test_a_wrong_password_is_refused(self):
        with self.assertRaises(ua.UaStatusCodeError):
            async with self.client(operator=True, password='not-the-password'):
                pass

    async def test_the_control_port_reports_state_and_writes_as_the_operator(self):
        status, state = await self.http('GET', '/state')
        self.assertEqual(status, 200)
        self.assertEqual((state['size'], state['totals']['points']), ('standard', 706))
        status, body = await self.http('POST', '/write', {'point': 'L03-VAV-2.temperature_setpoint', 'value': 23})
        self.assertEqual((status, body['status']), (200, 'Good'))
        self.assertEqual(self.bms.physics.read()['L03-VAV-2.temperature_setpoint'], 23.0)
        status, body = await self.http('POST', '/write', {'point': 'L03-VAV-2.temperature_setpoint', 'value': 40})
        self.assertEqual((status, body['status']), (400, 'BadOutOfRange'))
        status, body = await self.http('POST', '/write', {'point': 'L03-AHU-1.mode', 'value': 'Off'})
        self.assertEqual((status, body['value']), (200, 'Off'))
        status, _ = await self.http('POST', '/write', {'point': 'L99-VAV-1.temperature_setpoint', 'value': 21})
        self.assertEqual(status, 404)

    async def test_values_follow_the_building(self):
        async with self.client() as client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            node = client.get_node(ua.NodeId('RF-WX-1.outdoor_temperature', idx))
            before = await node.read_data_value()
            self.bms.physics.step(1800)
            await self.bms.publish()
            after = await node.read_data_value()
            self.assertGreater(after.SourceTimestamp, before.SourceTimestamp)


class ReadOnlyTest(ServerTest):
    writes = False

    async def test_with_writes_off_every_point_is_read_only(self):
        client = self.client(operator=True)
        async with client:
            idx = await client.get_namespace_index('urn:example:bms:example-tower')
            self.assertEqual(await self.write(client, idx, 'L03-VAV-2.temperature_setpoint', ua.Variant(21.0, ua.VariantType.Double)), 'BadNotWritable')


class CommandLineTest(unittest.TestCase):
    def test_export_model_prints_the_building_and_stops(self):
        result = subprocess.run([sys.executable, str(HERE / 'bms_server.py'), '--export-model', '--size', 'tower'],
                                capture_output=True, text=True, check=True, timeout=60)
        exported = json.loads(result.stdout)
        self.assertEqual(exported['totals'], {'levels': 14, 'points': 2466, 'commands': 531, 'devices': 294})

    def test_a_secrets_file_is_written_once_and_kept_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'devices' / 'bms-simulator.json'
            first = bms_server.operator_password(path)
            self.assertEqual(bms_server.operator_password(path), first)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
