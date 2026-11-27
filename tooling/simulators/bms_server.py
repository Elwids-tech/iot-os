#!/usr/bin/env python3
"""A simulated building management system server: Example Tower over OPC UA (spec 038).

Development tooling only; nothing in the product depends on it. The building is read
from bms/buildings/example-tower.yaml and runs its own physics and control loops
(bms/physics.py). Any standard OPC UA client can browse it, structured

    Example Campus / Example Tower / Level 3 / East / L03-VAV-2 / zone_temperature

or, with --style flat, as one folder of vendor-style tags (ET_L03_VAV_2.ZN-T).

Anonymous sessions read only. Writing a command point needs the operator: its name and
password, or its certificate. Both, and the server's own certificate, are generated
into .local/devices at first start. A control port answers GET /state,
GET /scenarios, POST /scenarios/{name} and POST /write, and serves the controls page.

    python tooling/simulators/bms_server.py --size standard --speed 60
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import pathlib
import random
import secrets
import signal
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs

from asyncua import Server, ua
from asyncua.crypto import uacrypto
from asyncua.crypto.cert_gen import setup_self_signed_certificate
from asyncua.crypto.permission_rules import USER_TYPES, PermissionRuleset, User, UserRole
from asyncua.crypto.truststore import TrustStore
from asyncua.crypto.validator import CertificateValidator, CertificateValidatorOptions
from asyncua.server.internal_session import InternalSession
from asyncua.server.user_managers import UserManager
from cryptography.x509.oid import ExtendedKeyUsageOID

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bms import controls as c  # noqa: E402
from bms.dynamics import SEASONS  # noqa: E402
from bms.model import MODEL_FILE, SIZES, Building, ModelError, build, export, load  # noqa: E402
from bms.naming import STYLES, flat_tags  # noqa: E402
from bms.physics import SimpleBuilding  # noqa: E402
from bms.scenarios import ScenarioError, Scenarios  # noqa: E402

REPO = HERE.parents[1] if len(HERE.parents) > 1 else HERE  # the image keeps the simulator at /simulator
SECRETS_FILE = REPO / '.local' / 'devices' / 'bms-simulator.json'
CERTIFICATES = REPO / '.local' / 'devices' / 'bms-simulator'
CONTROLS_PAGE = HERE / 'bms_controls.html'
OPERATOR = 'operator'
UPDATE_SECONDS = 1.0
SECURITY = {'none': ua.SecurityPolicyType.NoSecurity, 'basic256sha256': ua.SecurityPolicyType.Basic256Sha256_SignAndEncrypt}
AUTH = {'anonymous': ua.AnonymousIdentityToken, 'username': ua.UserNameIdentityToken, 'certificate': ua.X509IdentityToken}

# UNECE codes for the units the model uses (OPC UA EngineeringUnits, Part 8).
UNECE = {'°C': 'CEL', '%': 'P1', 'ppm': '59', 'Pa': 'PAL', 'kPa': 'KPA', 'L/s': 'G51', 'L/min': 'L2', 'kW': 'KWT',
         'kvar': 'KVR', 'V': 'VLT', 'A': 'AMP', 'Hz': 'HTZ', 'kWh': 'KWH', 'h': 'HUR', 'min': 'MIN', 'm/s': 'MTS',
         '°': 'DD', 'W/m²': 'D54', 'mm/h': 'H67', 'lx': 'LUX', 'kg': 'KGM', 'm³': 'MTQ'}
UNITS_URI = 'http://www.opcfoundation.org/UA/units/un/cefact'
BOOLEAN_LABELS = {'alarm': ('Alarm', 'Normal'), 'status': ('On', 'Off'), 'command': ('On', 'Off'), 'sensor': ('True', 'False')}
STATUS = {
    'Good': ua.StatusCodes.Good,
    'BadNoCommunication': ua.StatusCodes.BadNoCommunication,
    'BadSensorFailure': ua.StatusCodes.BadSensorFailure,
    'UncertainLastUsableValue': ua.StatusCodes.UncertainLastUsableValue,
}
NUMERIC = {ua.VariantType.Double, ua.VariantType.Float, ua.VariantType.Int16, ua.VariantType.Int32, ua.VariantType.Int64,
           ua.VariantType.UInt16, ua.VariantType.UInt32, ua.VariantType.UInt64, ua.VariantType.Byte, ua.VariantType.SByte}
INTEGER = NUMERIC - {ua.VariantType.Double, ua.VariantType.Float}

log = logging.getLogger('bms')


def unit_id(code: str) -> int:
    value = 0
    for char in code:
        value = (value << 8) | ord(char)
    return value


def camel(name: str) -> str:
    return ''.join(part.capitalize() for part in name.replace(',', ' ').replace('-', ' ').split())


def operator_password(path: pathlib.Path) -> str:
    """The operator's test password, written at first start and never committed."""
    if path.exists():
        return json.loads(path.read_text())['operator']['password']
    path.parent.mkdir(parents=True, exist_ok=True)
    password = secrets.token_urlsafe(18)
    path.write_text(json.dumps({'operator': {'username': OPERATOR, 'password': password}}, indent=2) + '\n')
    os.chmod(path, 0o600)
    return password


def fingerprint(der: bytes) -> str:
    return hashlib.sha256(der).hexdigest()


# Browse answers wait while the slow_browse scenario is on (a server attribute).
_browse = InternalSession.browse


async def _slow_browse(self, params):
    delay = getattr(self.iserver, 'bms_browse_delay', 0.0)
    if delay:
        await asyncio.sleep(delay)
    return await _browse(self, params)


InternalSession.browse = _slow_browse


class Credentials:
    """The test sign-in values and certificates, generated at first start into
    .local/devices and never committed."""

    def __init__(self, secrets_file: pathlib.Path, folder: pathlib.Path, namespace: str, hostname: str):
        self.secrets_file = secrets_file
        self.folder = folder
        self.namespace = namespace
        self.hostname = hostname
        self.server_certificate = folder / 'server-certificate.der'
        self.server_key = folder / 'server-key.pem'
        self.operator_certificate = folder / 'operator-certificate.der'
        self.operator_key = folder / 'operator-key.pem'
        self.trusted = folder / 'trusted'
        self.rejected = folder / 'rejected'
        self.password = ''

    async def ensure(self) -> 'Credentials':
        for path in (self.folder, self.trusted, self.rejected):
            path.mkdir(parents=True, exist_ok=True)
        os.chmod(self.folder, 0o700)
        self.password = operator_password(self.secrets_file)
        await self._server()
        await setup_self_signed_certificate(self.operator_key, self.operator_certificate, 'urn:example:bms:operator', 'localhost',
                                            [ExtendedKeyUsageOID.CLIENT_AUTH], {'commonName': 'Example Tower operator'})
        data = json.loads(self.secrets_file.read_text())
        data['operator'].update({'certificate': str(self.operator_certificate), 'private_key': str(self.operator_key)})
        data['server'] = {'certificate': str(self.server_certificate), 'fingerprint': self.server_fingerprint(),
                          'trusted_clients': str(self.trusted)}
        self.secrets_file.write_text(json.dumps(data, indent=2) + '\n')
        os.chmod(self.secrets_file, 0o600)
        return self

    async def _server(self) -> None:
        await setup_self_signed_certificate(self.server_key, self.server_certificate, self.namespace, self.hostname,
                                            [ExtendedKeyUsageOID.SERVER_AUTH, ExtendedKeyUsageOID.CLIENT_AUTH],
                                            {'commonName': 'Example Tower BMS simulator'})

    async def renew_server(self) -> None:
        """A new server certificate (the certificate_changed scenario)."""
        self.server_certificate.unlink(missing_ok=True)
        self.server_key.unlink(missing_ok=True)
        await self._server()
        data = json.loads(self.secrets_file.read_text())
        data['server']['fingerprint'] = self.server_fingerprint()
        self.secrets_file.write_text(json.dumps(data, indent=2) + '\n')

    def server_fingerprint(self) -> str:
        return fingerprint(self.server_certificate.read_bytes())

    def operator_der(self) -> bytes:
        return self.operator_certificate.read_bytes()


class Users(UserManager):
    """Anonymous sessions read. The operator, by name and password or by its
    certificate, may also write command points. Any other certificate reads."""

    def __init__(self, password: str, operator_certificate: bytes):
        self.password = password
        self.operator_certificate = operator_certificate

    def get_user(self, iserver, username=None, password=None, certificate=None):
        if username is not None:
            if username == OPERATOR and password is not None and secrets.compare_digest(password, self.password):
                return User(role=UserRole.User, name=OPERATOR)
            return None
        # asyncua passes the secure channel's certificate with every token, so only a
        # certificate it has just verified as an X509 identity token is a certificate
        # sign-in; everything else is anonymous.
        marked = getattr(iserver, 'bms_x509', None)
        if certificate is not None and certificate is marked:
            iserver.bms_x509 = None
            der = certificate if isinstance(certificate, bytes) else uacrypto.der_from_x509(certificate)
            if der == self.operator_certificate:
                return User(role=UserRole.User, name=OPERATOR)
            return User(role=UserRole.Anonymous, name='certificate')
        return User(role=UserRole.Anonymous)


class ReadAndWriteRules(PermissionRuleset):
    """Every signed-in session, anonymous included, may browse, read, subscribe and ask
    to write; whether a write is allowed is decided per point."""

    def __init__(self):
        allowed = set(map(ua.NodeId, USER_TYPES))
        self._allowed = {UserRole.Admin: None, UserRole.User: allowed, UserRole.Anonymous: allowed}

    def check_validity(self, user, action_type_id, body):
        allowed = self._allowed.get(user.role if user else UserRole.Anonymous)
        return allowed is None or action_type_id in allowed


class BmsServer:
    def __init__(self, building: Building, physics: SimpleBuilding, credentials: Credentials, host: str = '127.0.0.1',
                 port: int = 4840, style: str = 'structured', security: tuple = ('none', 'basic256sha256'),
                 auth: tuple = ('anonymous', 'username', 'certificate'), strict_trust: bool = False,
                 node_ids: str = 'stable', writes: bool = True):
        self.building = building
        self.physics = physics
        self.credentials = credentials
        self.host, self.port = host, port
        self.style, self.security, self.auth = style, tuple(security), tuple(auth)
        self.strict_trust, self.node_ids, self.writes = strict_trust, node_ids, writes
        self.endpoint = f'opc.tcp://{host}:{port}/'
        self.server: Server | None = None
        self.started = False
        self.clock_offset = 0.0
        self.browse_delay = 0.0
        self.one_session = False
        self.tags = flat_tags(building) if style == 'flat' else {}
        self.scenarios = Scenarios(physics, self.hooks())
        self._tasks: set[asyncio.Task] = set()

    # Start, stop and restart ---------------------------------------------------------

    async def start(self) -> None:
        creds = self.credentials
        self.server = s = Server(user_manager=Users(creds.password, creds.operator_der()))
        await s.init()
        s.set_endpoint(self.endpoint)
        s.set_server_name(f'{self.building.info["name"]} BMS simulator')
        await s.set_application_uri(self.building.info['namespace'])
        await s.load_certificate(str(creds.server_certificate))
        await s.load_private_key(str(creds.server_key))
        s.set_security_policy([SECURITY[name] for name in self.security], permission_ruleset=ReadAndWriteRules())
        s.set_identity_tokens([AUTH[name] for name in self.auth])
        if self.strict_trust:
            s.set_certificate_validator(self._validate)
        s.iserver.bms_browse_delay = self.browse_delay
        if self.one_session:
            s.iserver.max_connections = 1
        verify = s.iserver.verify_x509_token

        def verify_and_mark(isession, token, signature):
            certificate = verify(isession, token, signature)
            s.iserver.bms_x509 = certificate
            return certificate

        s.iserver.verify_x509_token = verify_and_mark
        self.idx = await s.register_namespace(self.building.info['namespace'])
        self.nodes: dict[str, ua.NodeId] = {}
        self.points_by_node: dict[ua.NodeId, str] = {}
        self.last: dict[str, tuple] = {}
        self._numbers: dict[str, int] = {}
        self._next = random.SystemRandom().randrange(10_000, 900_000)
        if self.style == 'flat':
            await self._flat()
        else:
            await self._structured()
        self._intercept_writes()
        await s.start()
        self.started = True
        log.info('Serving %s (%s) at %s: %s', self.building.info['name'], self.style, self.endpoint, self.building.totals())

    async def stop(self) -> None:
        if self.started and self.server:
            self.started = False
            await self.server.stop()

    async def restart(self, seconds: float, renew: bool = False) -> None:
        await self.stop()
        await asyncio.sleep(seconds)
        if renew:
            await self.credentials.renew_server()
        await self.start()

    def hooks(self) -> dict:
        def later(coroutine):
            task = asyncio.get_running_loop().create_task(coroutine)
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

        def server_restart(on, seconds):
            later(self.restart(seconds))

        def certificate_changed(on, _):
            later(self.restart(1.0, renew=True))

        def clock_wrong(on, seconds):
            self.clock_offset = seconds if on else 0.0
            self.last.clear()  # republish every value with the new source time

        def session_limit(on, _):
            self.one_session = on
            if self.server:
                self.server.iserver.max_connections = 1 if on else 1_000

        def slow_browse(on, seconds):
            self.browse_delay = seconds if on else 0.0
            if self.server:
                self.server.iserver.bms_browse_delay = self.browse_delay

        return {'server_restart': server_restart, 'certificate_changed': certificate_changed, 'clock_wrong': clock_wrong,
                'session_limit': session_limit, 'slow_browse': slow_browse}

    async def _validate(self, certificate, application) -> None:
        """--strict-trust: a client certificate must be in the trusted folder. A refused
        one is saved in the rejected folder, to be moved across."""
        store = TrustStore([self.credentials.trusted], [])
        known = any(p.suffix in ('.der', '.pem') for p in self.credentials.trusted.iterdir())
        if known:
            await store.load()  # asyncua refuses to load an empty store
        if not known or not store.is_trusted(certificate):
            der = uacrypto.der_from_x509(certificate)
            (self.credentials.rejected / f'{fingerprint(der)[:16]}.der').write_bytes(der)
            raise ua.uaerrors.BadCertificateUntrusted()
        validator = CertificateValidator(CertificateValidatorOptions.TIME_RANGE | CertificateValidatorOptions.TRUSTED, store)
        await validator.validate(certificate, application)

    # The address space -------------------------------------------------------------

    def _node(self, key: str) -> ua.NodeId:
        if self.node_ids == 'stable':
            return ua.NodeId(key, self.idx)
        number = self._numbers.get(key)
        if number is None:
            number = self._numbers[key] = self._next
            self._next += 1
        return ua.NodeId(number, self.idx)

    def _add(self, items: list[ua.AddNodesItem]) -> None:
        for result in self.server.iserver.node_mgt_service.add_nodes(items):
            if not result.StatusCode.is_good():
                raise RuntimeError(f'could not add a node: {result.StatusCode}')

    def _object(self, key: str, name: str, parent: ua.NodeId, type_id: ua.NodeId, description: str = '',
                browse: str | None = None) -> ua.AddNodesItem:
        attrs = ua.ObjectAttributes(DisplayName=ua.LocalizedText(name), Description=ua.LocalizedText(description or name), EventNotifier=0)
        return ua.AddNodesItem(ParentNodeId=parent, ReferenceTypeId=ua.NodeId(ua.ObjectIds.Organizes), RequestedNewNodeId=self._node(key),
                               BrowseName=ua.QualifiedName(browse or name, self.idx), NodeClass=ua.NodeClass.Object,
                               NodeAttributes=attrs, TypeDefinition=type_id)

    @staticmethod
    def _variable(node: ua.NodeId, browse: ua.QualifiedName, name: str, description: str, parent: ua.NodeId, value: ua.Variant,
                  data_type: int, type_id: int, reference: int, access: int, rank: int = -1) -> ua.AddNodesItem:
        attrs = ua.VariableAttributes(DisplayName=ua.LocalizedText(name), Description=ua.LocalizedText(description),
                                      Value=value, DataType=ua.NodeId(data_type), ValueRank=rank,
                                      AccessLevel=access, UserAccessLevel=access)
        return ua.AddNodesItem(ParentNodeId=parent, ReferenceTypeId=ua.NodeId(reference), RequestedNewNodeId=node,
                               BrowseName=browse, NodeClass=ua.NodeClass.Variable, NodeAttributes=attrs,
                               TypeDefinition=ua.NodeId(type_id))

    def _property(self, owner: str, name: str, value: ua.Variant, data_type: int, rank: int = -1) -> ua.AddNodesItem:
        return self._variable(self._node(f'{owner}#{name}'), ua.QualifiedName(name, 0), name, name, self._node(owner), value,
                              data_type, ua.ObjectIds.PropertyType, ua.ObjectIds.HasProperty, ua.AccessLevel.CurrentRead.mask, rank)

    async def _structured(self) -> None:
        """Folders for the site, building, levels and zones; each equipment item an
        object of its own type, with its points."""
        b = self.building
        objects = ua.NodeId(ua.ObjectIds.ObjectsFolder)
        folder = ua.NodeId(ua.ObjectIds.FolderType)
        types = {}
        items = []
        for type_key in sorted({e.type for e in b.equipment.values()}):
            spec = b.library[type_key]
            type_node = self._node(f'type:{type_key}')
            types[type_key] = type_node
            attrs = ua.ObjectTypeAttributes(DisplayName=ua.LocalizedText(spec['name']), Description=ua.LocalizedText(spec['name']), IsAbstract=False)
            items.append(ua.AddNodesItem(ParentNodeId=ua.NodeId(ua.ObjectIds.BaseObjectType), ReferenceTypeId=ua.NodeId(ua.ObjectIds.HasSubtype),
                                         RequestedNewNodeId=type_node, BrowseName=ua.QualifiedName(f'{camel(spec["name"])}Type', self.idx),
                                         NodeClass=ua.NodeClass.ObjectType, NodeAttributes=attrs))
        site, tower = b.site, b.info
        items.append(self._object(site['key'], site['name'], objects, folder))
        items.append(self._object(tower['key'], tower['name'], self._node(site['key']), folder))
        for level in b.levels.values():
            items.append(self._object(level.key, level.name, self._node(tower['key']), folder, browse=level.key))
            for zone_key in level.zones:
                zone = b.zones[zone_key]
                items.append(self._object(zone.key, zone.name, self._node(level.key), folder, f'{zone.name}, {level.name}', browse=zone.key))
        for item in b.equipment.values():
            parent = self._node(item.zone if item.zone else item.level)
            where = b.zones[item.zone].name if item.zone else b.levels[item.level].name
            items.append(self._object(item.key, item.key, parent, types[item.type], f'{item.name}, {where}', browse=item.key))
        self._add(items)
        await self._points(lambda point: (point.short, point.name, self._node(point.equipment)))

    async def _flat(self) -> None:
        """One folder of tags, the way many vendors serve their points."""
        b = self.building
        folder_key = f'{b.info["key"]}_tags'
        self._add([self._object(folder_key, f'{b.info["name"]} tags', ua.NodeId(ua.ObjectIds.ObjectsFolder),
                                ua.NodeId(ua.ObjectIds.FolderType), browse=b.info['key'])])
        parent = self._node(folder_key)
        await self._points(lambda point: (self.tags[point.key], self.tags[point.key], parent))

    async def _points(self, place) -> None:
        items = []
        values = self.physics.read()
        for point in self.building.points.values():
            browse, name, parent = place(point)
            node = self._node(point.key if self.style == 'structured' else self.tags[point.key])
            self.nodes[point.key] = node
            self.points_by_node[node] = point.key
            spec = point.spec
            access = ua.AccessLevel.CurrentRead.mask
            if point.writable and self.writes:
                access |= ua.AccessLevel.CurrentWrite.mask
            variant = self._variant(point, values[point.key])
            kind = spec['type']
            data_type, type_id = {
                'number': (ua.ObjectIds.Double, ua.ObjectIds.AnalogItemType),
                'boolean': (ua.ObjectIds.Boolean, ua.ObjectIds.TwoStateDiscreteType),
                'state': (ua.ObjectIds.UInt32, ua.ObjectIds.MultiStateDiscreteType),
            }.get(kind, (ua.ObjectIds.String, ua.ObjectIds.BaseDataVariableType))
            owner = point.key if self.style == 'structured' else self.tags[point.key]
            items.append(self._variable(node, ua.QualifiedName(browse, self.idx), name, point.description, parent, variant,
                                        data_type, type_id, ua.ObjectIds.HasComponent, access))
            if kind == 'number':
                low, high = spec.get('limits') or spec.get('range') or (0.0, 0.0)
                items.append(self._property(owner, 'EURange', ua.Variant(ua.Range(Low=float(low), High=float(high))), ua.ObjectIds.Range))
                if spec.get('unit'):
                    unit = ua.EUInformation(NamespaceUri=UNITS_URI, UnitId=unit_id(UNECE[spec['unit']]),
                                            DisplayName=ua.LocalizedText(spec['unit']), Description=ua.LocalizedText(spec['unit']))
                    items.append(self._property(owner, 'EngineeringUnits', ua.Variant(unit), ua.ObjectIds.EUInformation))
            elif kind == 'boolean':
                true, false = BOOLEAN_LABELS.get(point.kind, ('True', 'False'))
                items.append(self._property(owner, 'TrueState', ua.Variant(ua.LocalizedText(true)), ua.ObjectIds.LocalizedText))
                items.append(self._property(owner, 'FalseState', ua.Variant(ua.LocalizedText(false)), ua.ObjectIds.LocalizedText))
            elif kind == 'state':
                labels = [ua.LocalizedText(s) for s in spec['states']]
                items.append(self._property(owner, 'EnumStrings', ua.Variant(labels, ua.VariantType.LocalizedText), ua.ObjectIds.LocalizedText, rank=1))
        self._add(items)
        await self.publish(values)

    @staticmethod
    def _variant(point, value) -> ua.Variant:
        kind = point.spec['type']
        if kind == 'number':
            return ua.Variant(float(value), ua.VariantType.Double)
        if kind == 'boolean':
            return ua.Variant(bool(value), ua.VariantType.Boolean)
        if kind == 'state':
            return ua.Variant(point.spec['states'].index(value), ua.VariantType.UInt32)
        return ua.Variant(str(value), ua.VariantType.String)

    # Values ------------------------------------------------------------------------

    async def publish(self, values: dict | None = None) -> None:
        """Write the values that changed since the last publish, with their status and
        the simulated time (shifted while the clock is wrong) as their source time."""
        if not self.started and values is None:
            return
        values = values if values is not None else self.physics.read()
        source = self.physics.now + timedelta(seconds=self.clock_offset)
        now = datetime.now(timezone.utc)
        for key, value in values.items():
            quality = self.physics.quality(key)
            if self.last.get(key) == (value, quality):
                continue
            self.last[key] = (value, quality)
            point = self.building.points[key]
            status = ua.StatusCode(STATUS.get(quality, ua.StatusCodes.Good))
            data = ua.DataValue(self._variant(point, value), StatusCode=status, SourceTimestamp=source, ServerTimestamp=now)
            await self.server.write_attribute_value(self.nodes[key], data)

    async def run(self, speed: float) -> None:
        loop = asyncio.get_running_loop()
        last = loop.time()
        while True:
            await asyncio.sleep(UPDATE_SECONDS)
            now = loop.time()
            self.physics.step((now - last) * speed)  # the building runs on while the server restarts
            last = now
            if self.started:
                await self.publish()

    # Writes ------------------------------------------------------------------------

    def check(self, point_key: str, value, user: User) -> tuple[str, object]:
        """The status a write gets, and the value to store when it is good."""
        point = self.building.points.get(point_key)
        if point is None or not point.writable or not self.writes:
            return c.NOT_WRITABLE, None
        if user.role not in (UserRole.User, UserRole.Admin):
            return c.ACCESS_DENIED, None
        return c.check_write(point.spec, value)

    async def apply(self, point_key: str, value) -> None:
        self.physics.apply(point_key, value)
        self.last.pop(point_key, None)
        if self.started:
            await self.publish({point_key: self.physics.read()[point_key]})

    def _intercept_writes(self) -> None:
        service = self.server.iserver.attribute_service
        original = service.write

        async def write(params: ua.WriteParameters, user: User = User(role=UserRole.Admin)) -> list[ua.StatusCode]:
            results = []
            for item in params.NodesToWrite:
                point_key = self.points_by_node.get(item.NodeId)
                if point_key is None:
                    if user.role == UserRole.Admin:
                        results.extend(await original(ua.WriteParameters(NodesToWrite=[item]), user))
                    else:
                        results.append(ua.StatusCode(ua.StatusCodes.BadNotWritable))
                    continue
                if item.AttributeId != ua.AttributeIds.Value:
                    results.append(ua.StatusCode(ua.StatusCodes.BadNotWritable))
                    continue
                value = self._python_value(self.building.points[point_key], item.Value.Value)
                status, stored = self.check(point_key, value, user)
                if status == c.GOOD:
                    await self.apply(point_key, stored)
                results.append(ua.StatusCode(getattr(ua.StatusCodes, status)))
            return results

        service.write = write

    @staticmethod
    def _python_value(point, variant: ua.Variant | None):
        """The written value as the command rules see it: a wrong OPC UA type becomes a
        value of the wrong Python type, so the rules refuse it as a type mismatch."""
        if variant is None:
            return None
        kind = point.spec['type']
        vtype, value = variant.VariantType, variant.Value
        if kind == 'number' and vtype in NUMERIC:
            return float(value)
        if kind == 'state' and vtype in INTEGER:
            return int(value)
        if kind == 'boolean' and vtype == ua.VariantType.Boolean:
            return bool(value)
        return object()  # any other type is a mismatch


class ControlPort:
    """An HTTP port for tests and for trying faults and controls by hand: GET / (the
    controls page), GET /state, GET /values, GET /scenarios, POST /scenarios/{name}, POST /write."""

    def __init__(self, bms: BmsServer, args: argparse.Namespace):
        self.bms = bms
        self.args = args

    async def start(self, host: str, port: int):
        return await asyncio.start_server(self._handle, host, port)

    def state(self) -> dict:
        b, p = self.bms, self.bms.physics
        return {'building': b.building.info['name'], 'size': b.building.size, 'style': b.style, 'speed': self.args.speed,
                'seed': self.args.seed, 'season': self.args.season, 'simulated_time': p.now.isoformat(),
                'writes': 'on' if b.writes else 'off', 'endpoint': b.endpoint, 'serving': b.started,
                'security': list(b.security), 'auth': list(b.auth), 'strict_trust': b.strict_trust, 'node_ids': b.node_ids,
                'server_certificate': b.credentials.server_fingerprint(), 'scenarios': b.scenarios.state(),
                'totals': b.building.totals()}

    async def write(self, body: dict) -> tuple[int, dict]:
        point, value = body.get('point'), body.get('value')
        if point not in self.bms.building.points:
            return 404, {'point': point, 'status': 'BadNodeIdUnknown'}
        status, stored = self.bms.check(point, value, User(role=UserRole.User, name=OPERATOR))
        if status != c.GOOD:
            return 400, {'point': point, 'status': status}
        await self.bms.apply(point, stored)
        return 200, {'point': point, 'value': stored, 'status': status}

    def values(self, query: str) -> tuple[int, dict]:
        """GET /values?points=a,b: each point's value and status."""
        keys = [k for k in ','.join(parse_qs(query).get('points', [])).split(',') if k]
        values = self.bms.physics.read()
        unknown = [k for k in keys if k not in values]
        if unknown or not keys:
            return 404, {'error': f'Unknown points: {", ".join(unknown)}' if unknown else 'Name the points, as ?points=a,b.'}
        return 200, {'simulated_time': self.bms.physics.now.isoformat(),
                     'values': {k: {'value': values[k], 'status': self.bms.physics.quality(k),
                                    'unit': self.bms.building.points[k].spec.get('unit')} for k in keys}}

    def scenario(self, name: str, body: dict) -> tuple[int, dict]:
        on = body.get('on', True)
        if not isinstance(on, bool):
            return 400, {'error': '"on" must be true or false.'}
        try:
            target = self.bms.scenarios.switch(name, on, body.get('target'))
        except ScenarioError as error:
            return (404 if 'no scenario called' in str(error) else 400), {'error': str(error)}
        return 200, {'name': name, 'on': on, 'target': target, 'scenarios': self.bms.scenarios.state()}

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        content_type = 'application/json'
        try:
            head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 5)
            lines = head.decode('latin-1').split('\r\n')
            method, path, _ = lines[0].split(' ', 2)
            path, _, query = path.partition('?')
            headers = {k.strip().lower(): v.strip() for k, v in (line.split(':', 1) for line in lines[1:] if ':' in line)}
            length = int(headers.get('content-length', '0'))
            raw = await asyncio.wait_for(reader.readexactly(length), 5) if length else b''
            payload = {}
            if raw:
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    raise ValueError('The body must be a JSON object.')
            if method == 'OPTIONS':
                code, body = 204, None
            elif method == 'GET' and path in ('/', '/bms_controls.html'):
                code, body, content_type = 200, CONTROLS_PAGE.read_bytes(), 'text/html; charset=utf-8'
            elif method == 'GET' and path == '/state':
                code, body = 200, self.state()
            elif method == 'GET' and path == '/values':
                code, body = self.values(query)
            elif method == 'GET' and path == '/scenarios':
                code, body = 200, {'scenarios': self.bms.scenarios.catalogue()}
            elif method == 'POST' and path.startswith('/scenarios/'):
                code, body = self.scenario(path.rsplit('/', 1)[1], payload)
            elif method == 'POST' and path == '/write':
                code, body = await self.write(payload)
            else:
                code, body = 404, {'error': 'Not found.'}
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, ValueError) as error:
            code, body = 400, {'error': str(error) or 'Bad request.'}
        data = b'' if body is None else body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        reason = {200: 'OK', 204: 'No Content', 400: 'Bad Request', 404: 'Not Found'}[code]
        writer.write((f'HTTP/1.1 {code} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {len(data)}\r\n'
                      'Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n'
                      'Access-Control-Allow-Headers: Content-Type\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n').encode() + data)
        await writer.drain()
        writer.close()


def parse(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Example Tower, a simulated BMS server over OPC UA (spec 038).')
    parser.add_argument('--style', choices=STYLES, default='structured')
    parser.add_argument('--size', choices=SIZES, default='standard')
    parser.add_argument('--writes', choices=('on', 'off'), default='on')
    parser.add_argument('--season', choices=sorted(SEASONS), default='summer')
    parser.add_argument('--export-model', action='store_true', help='print the building model as JSON and stop')
    parser.add_argument('--speed', type=float, default=1.0, help='simulated seconds per second')
    parser.add_argument('--seed', type=int, default=7)
    parser.add_argument('--security', nargs='+', choices=sorted(SECURITY), default=['none', 'basic256sha256'])
    parser.add_argument('--auth', nargs='+', choices=sorted(AUTH), default=['anonymous', 'username', 'certificate'])
    parser.add_argument('--host', default='127.0.0.1', help='the name the endpoint is served and advertised on')
    parser.add_argument('--port', type=int, default=4840)
    parser.add_argument('--control-port', type=int, default=4841)
    parser.add_argument('--control-host', default='127.0.0.1', help='where the control port listens; keep it on loopback')
    parser.add_argument('--strict-trust', action='store_true', help='refuse client certificates until they are in the trusted folder')
    parser.add_argument('--node-ids', choices=('stable', 'renumber'), default='stable')
    parser.add_argument('--model', default=str(MODEL_FILE), help=argparse.SUPPRESS)
    parser.add_argument('--secrets', default=str(SECRETS_FILE), help='where the operator test sign-in is kept')
    parser.add_argument('--certificates', default=str(CERTIFICATES), help='where the certificates and trusted folder are kept')
    args = parser.parse_args(argv)
    if args.speed <= 0:
        parser.error('--speed must be above zero')
    return args


async def create(args: argparse.Namespace) -> tuple[BmsServer, Credentials]:
    building = build(load(args.model), args.size)
    hostname = args.host if args.host not in ('0.0.0.0', '127.0.0.1') else 'localhost'
    credentials = await Credentials(pathlib.Path(args.secrets), pathlib.Path(args.certificates), building.info['namespace'], hostname).ensure()
    physics = SimpleBuilding(building, seed=args.seed, season=args.season)
    bms = BmsServer(building, physics, credentials, args.host, args.port, args.style, tuple(dict.fromkeys(args.security)),
                    tuple(dict.fromkeys(args.auth)), args.strict_trust, args.node_ids, args.writes == 'on')
    return bms, credentials


async def serve(args: argparse.Namespace) -> None:
    bms, credentials = await create(args)
    await bms.start()
    control = await ControlPort(bms, args).start(args.control_host, args.control_port)
    print(f'Example Tower ({args.size}, {args.style}, {bms.building.totals()["points"]} points) at {bms.endpoint}; '
          f'controls at http://{args.control_host}:{args.control_port}/; sign-in in {args.secrets}', flush=True)
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        asyncio.get_running_loop().add_signal_handler(sig, stop.set)
    runner = asyncio.create_task(bms.run(args.speed))
    try:
        await stop.wait()
    finally:
        runner.cancel()
        control.close()
        await bms.stop()


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    logging.basicConfig(level=logging.WARNING, format='%(levelname)s %(name)s: %(message)s')
    logging.getLogger('bms').setLevel(logging.INFO)
    if args.export_model:
        try:
            print(json.dumps(export(build(load(args.model), args.size)), indent=2, ensure_ascii=False))
        except ModelError as error:
            print(f'model error: {error}', file=sys.stderr)
            return 1
        return 0
    asyncio.run(serve(args))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
