#!/usr/bin/env python3
"""A simulated building management system server: Example Tower over OPC UA (spec 038).

Development tooling only; nothing in the product depends on it. The building is read
from bms/buildings/example-tower.yaml and runs its own physics and control loops
(bms/physics.py). Any standard OPC UA client can browse it:

    Example Campus / Example Tower / Level 3 / East / L03-VAV-2 / Zone temperature

Anonymous sessions read only. Writing a command point needs the `operator` sign-in,
whose password is generated into .local/devices/bms-simulator.json at first start.
A loopback-only control port answers GET /state and POST /write.

    python tooling/simulators/bms_server.py --size standard --speed 60
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import pathlib
import secrets
import signal
import sys
from datetime import datetime, timezone

from asyncua import Server, ua
from asyncua.crypto.permission_rules import USER_TYPES, PermissionRuleset, User, UserRole
from asyncua.server.user_managers import UserManager

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bms import controls as c  # noqa: E402
from bms.model import MODEL_FILE, SIZES, Building, ModelError, build, export, load  # noqa: E402
from bms.physics import SimpleBuilding  # noqa: E402
from bms.dynamics import SEASONS  # noqa: E402

REPO = HERE.parents[1]
SECRETS_FILE = REPO / '.local' / 'devices' / 'bms-simulator.json'
OPERATOR = 'operator'
UPDATE_SECONDS = 1.0

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


class Users(UserManager):
    """Anonymous sessions read; the operator may also write command points."""

    def __init__(self, password: str):
        self.password = password

    def get_user(self, iserver, username=None, password=None, certificate=None):
        # Only anonymous and name-and-password tokens are accepted (set_identity_tokens),
        # so a session without a user name is anonymous; asyncua passes the secure
        # channel's certificate along even then.
        if username is None:
            return User(role=UserRole.Anonymous)
        if username == OPERATOR and password is not None and secrets.compare_digest(password, self.password):
            return User(role=UserRole.User, name=OPERATOR)
        return None


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
    def __init__(self, building: Building, physics: SimpleBuilding, host: str, port: int, password: str, writes: bool = True):
        self.building = building
        self.physics = physics
        self.host, self.port = host, port
        self.password = password
        self.writes = writes
        self.server = Server(user_manager=Users(password))
        self.idx = 0
        self.nodes: dict[str, ua.NodeId] = {}
        self.points_by_node: dict[ua.NodeId, str] = {}
        self.last: dict[str, tuple] = {}
        self.endpoint = f'opc.tcp://{host}:{port}/'

    # Start and stop ----------------------------------------------------------------

    async def start(self) -> None:
        s = self.server
        await s.init()
        s.set_endpoint(self.endpoint)
        s.set_server_name(f'{self.building.info["name"]} BMS simulator')
        await s.set_application_uri(self.building.info['namespace'])
        s.set_security_policy([ua.SecurityPolicyType.NoSecurity], permission_ruleset=ReadAndWriteRules())
        s.set_identity_tokens([ua.AnonymousIdentityToken, ua.UserNameIdentityToken])
        self.idx = await s.register_namespace(self.building.info['namespace'])
        await self._address_space()
        self._intercept_writes()
        await s.start()
        log.info('Serving %s at %s: %s', self.building.info['name'], self.endpoint, self.building.totals())

    async def stop(self) -> None:
        await self.server.stop()

    # The address space -------------------------------------------------------------

    def _node(self, key: str) -> ua.NodeId:
        return ua.NodeId(key, self.idx)

    def _add(self, items: list[ua.AddNodesItem]) -> None:
        for result in self.server.iserver.node_mgt_service.add_nodes(items):
            if not result.StatusCode.is_good():
                raise RuntimeError(f'could not add a node: {result.StatusCode}')

    def _object(self, key: str, name: str, parent: ua.NodeId, type_id: ua.NodeId, description: str = '',
                reference: int = ua.ObjectIds.Organizes, browse: str | None = None) -> ua.AddNodesItem:
        attrs = ua.ObjectAttributes(DisplayName=ua.LocalizedText(name), Description=ua.LocalizedText(description or name), EventNotifier=0)
        return ua.AddNodesItem(ParentNodeId=parent, ReferenceTypeId=ua.NodeId(reference), RequestedNewNodeId=self._node(key),
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

    async def _address_space(self) -> None:
        b = self.building
        objects = ua.NodeId(ua.ObjectIds.ObjectsFolder)
        folder = ua.NodeId(ua.ObjectIds.FolderType)
        # One object type a kind of equipment, so a client can tell a zone box from a pump.
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
            items.append(self._object(item.key, item.key, parent, types[item.type], f'{item.name}, {where}',
                                      reference=ua.ObjectIds.Organizes, browse=item.key))
        self._add(items)

        items = []
        values = self.physics.read()
        for point in b.points.values():
            node = self._node(point.key)
            self.nodes[point.key] = node
            self.points_by_node[node] = point.key
            spec = point.spec
            access = ua.AccessLevel.CurrentRead.mask
            if point.writable and self.writes:
                access |= ua.AccessLevel.CurrentWrite.mask
            variant = self._variant(point, values[point.key])
            kind = spec['type']
            if kind == 'number':
                data_type, type_id = ua.ObjectIds.Double, ua.ObjectIds.AnalogItemType
            elif kind == 'boolean':
                data_type, type_id = ua.ObjectIds.Boolean, ua.ObjectIds.TwoStateDiscreteType
            elif kind == 'state':
                data_type, type_id = ua.ObjectIds.UInt32, ua.ObjectIds.MultiStateDiscreteType
            else:
                data_type, type_id = ua.ObjectIds.String, ua.ObjectIds.BaseDataVariableType
            items.append(self._variable(node, ua.QualifiedName(point.short, self.idx), point.name, point.description,
                                        self._node(point.equipment), variant, data_type, type_id, ua.ObjectIds.HasComponent, access))
            if kind == 'number':
                low, high = spec.get('limits') or spec.get('range') or (0.0, 0.0)
                items.append(self._property(point.key, 'EURange', ua.Variant(ua.Range(Low=float(low), High=float(high))), ua.ObjectIds.Range))
                if spec.get('unit'):
                    code = UNECE[spec['unit']]
                    unit = ua.EUInformation(NamespaceUri=UNITS_URI, UnitId=unit_id(code), DisplayName=ua.LocalizedText(spec['unit']),
                                            Description=ua.LocalizedText(spec['unit']))
                    items.append(self._property(point.key, 'EngineeringUnits', ua.Variant(unit), ua.ObjectIds.EUInformation))
            elif kind == 'boolean':
                true, false = BOOLEAN_LABELS.get(point.kind, ('True', 'False'))
                items.append(self._property(point.key, 'TrueState', ua.Variant(ua.LocalizedText(true)), ua.ObjectIds.LocalizedText))
                items.append(self._property(point.key, 'FalseState', ua.Variant(ua.LocalizedText(false)), ua.ObjectIds.LocalizedText))
            elif kind == 'state':
                labels = [ua.LocalizedText(s) for s in spec['states']]
                items.append(self._property(point.key, 'EnumStrings', ua.Variant(labels, ua.VariantType.LocalizedText), ua.ObjectIds.LocalizedText, rank=1))
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
        the simulated time as their source time."""
        values = values if values is not None else self.physics.read()
        source = self.physics.now
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
            self.physics.step((now - last) * speed)
            last = now
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

    def apply(self, point_key: str, value) -> None:
        self.physics.apply(point_key, value)
        self.last.pop(point_key, None)

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
                    self.apply(point_key, stored)
                    await self.publish({point_key: self.physics.read()[point_key]})
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
    """A loopback-only HTTP port for tests and trying controls by hand."""

    def __init__(self, bms: BmsServer, args: argparse.Namespace):
        self.bms = bms
        self.args = args

    async def start(self, host: str, port: int):
        return await asyncio.start_server(self._handle, host, port)

    def state(self) -> dict:
        p = self.bms.physics
        return {'building': self.bms.building.info['name'], 'size': self.bms.building.size, 'speed': self.args.speed,
                'seed': self.args.seed, 'season': self.args.season, 'simulated_time': p.now.isoformat(),
                'writes': 'on' if self.bms.writes else 'off', 'endpoint': self.bms.endpoint, 'scenarios': {},
                'totals': self.bms.building.totals()}

    async def write(self, body: dict) -> tuple[int, dict]:
        point, value = body.get('point'), body.get('value')
        if point not in self.bms.building.points:
            return 404, {'point': point, 'status': 'BadNodeIdUnknown'}
        status, stored = self.bms.check(point, value, User(role=UserRole.User, name=OPERATOR))
        if status != c.GOOD:
            return 400, {'point': point, 'status': status}
        self.bms.apply(point, stored)
        await self.bms.publish({point: self.bms.physics.read()[point]})
        return 200, {'point': point, 'value': stored, 'status': status}

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 5)
            lines = head.decode('latin-1').split('\r\n')
            method, path, _ = lines[0].split(' ', 2)
            headers = {k.strip().lower(): v.strip() for k, v in (line.split(':', 1) for line in lines[1:] if ':' in line)}
            length = int(headers.get('content-length', '0'))
            raw = await asyncio.wait_for(reader.readexactly(length), 5) if length else b''
            if method == 'OPTIONS':
                code, body = 204, None
            elif method == 'GET' and path == '/state':
                code, body = 200, self.state()
            elif method == 'POST' and path == '/write':
                try:
                    payload = json.loads(raw or b'{}')
                except json.JSONDecodeError:
                    code, body = 400, {'error': 'The body must be JSON.'}
                else:
                    code, body = await self.write(payload if isinstance(payload, dict) else {})
            else:
                code, body = 404, {'error': 'Not found.'}
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, ValueError):
            code, body = 400, {'error': 'Bad request.'}
        data = b'' if body is None else json.dumps(body, ensure_ascii=False).encode()
        reason = {200: 'OK', 204: 'No Content', 400: 'Bad Request', 404: 'Not Found'}[code]
        writer.write((f'HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\nContent-Length: {len(data)}\r\n'
                      'Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n'
                      'Access-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n').encode() + data)
        await writer.drain()
        writer.close()


def parse(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Example Tower, a simulated BMS server over OPC UA (spec 038).')
    parser.add_argument('--size', choices=SIZES, default='standard')
    parser.add_argument('--speed', type=float, default=1.0, help='simulated seconds per second')
    parser.add_argument('--seed', type=int, default=7)
    parser.add_argument('--season', choices=sorted(SEASONS), default='summer')
    parser.add_argument('--writes', choices=('on', 'off'), default='on')
    parser.add_argument('--export-model', action='store_true', help='print the building model as JSON and stop')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=4840)
    parser.add_argument('--control-port', type=int, default=4841)
    parser.add_argument('--model', default=str(MODEL_FILE), help=argparse.SUPPRESS)
    parser.add_argument('--secrets', default=str(SECRETS_FILE), help='where the operator test sign-in is kept')
    args = parser.parse_args(argv)
    if args.speed <= 0:
        parser.error('--speed must be above zero')
    return args


async def serve(args: argparse.Namespace) -> None:
    building = build(load(args.model), args.size)
    physics = SimpleBuilding(building, seed=args.seed, season=args.season)
    bms = BmsServer(building, physics, args.host, args.port, operator_password(pathlib.Path(args.secrets)), args.writes == 'on')
    await bms.start()
    control = await ControlPort(bms, args).start('127.0.0.1', args.control_port)
    print(f'Example Tower ({args.size}, {building.totals()["points"]} points) at {bms.endpoint}; '
          f'control port http://127.0.0.1:{args.control_port}; operator sign-in in {args.secrets}', flush=True)
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
