#!/usr/bin/env python3
"""A Modbus RTU bus for the RT1050 gateway bench (docs/hardware/rt1050-evkb.md): one serial
port, usually a USB-RS485 adapter, where every address from --first to --last answers
reads of holding registers 0 to 3 with the register map the board example polls
(firmware/sdk/examples/rt1050-evkb-ethernet/app/modbus_rtu.h):

    0  status, 1 when healthy
    1  reading, high word } a 32-bit counter that grows by the address every second
    2  reading, low word  }
    3  temperature in tenths of a degree Celsius, signed: 20.0 plus a tenth per address

    python3 tooling/hardware/modbus_simulator.py --port /dev/ttyUSB0 --baud 9600

Install the pinned pymodbus first: pip install -r tooling/hardware/requirements.txt.
"""

import argparse
import sys
import time

REGISTER_COUNT = 4
FIRST_ADDRESS = 1
LAST_ADDRESS = 247


def registers(address: int, elapsed_s: float) -> list[int]:
    """The four holding registers of one address, elapsed_s seconds after the start."""
    if not FIRST_ADDRESS <= address <= LAST_ADDRESS:
        raise ValueError(f"Modbus addresses run from {FIRST_ADDRESS} to {LAST_ADDRESS}, not {address}")
    counter = (address * 1000 + int(elapsed_s) * address) & 0xFFFFFFFF
    temperature = 200 + address  # tenths of a degree
    return [1, counter >> 16, counter & 0xFFFF, temperature & 0xFFFF]


def build_context(first: int, last: int, started: float):
    """A pymodbus server context where each address computes its registers when read."""
    from pymodbus.datastore import ModbusDeviceContext, ModbusSequentialDataBlock, ModbusServerContext

    class Registers(ModbusSequentialDataBlock):
        def __init__(self, address: int):
            super().__init__(1, [0] * REGISTER_COUNT)
            self.device = address

        # pymodbus hands a data block the register number plus one (its 1-based addressing).
        def getValues(self, address, count=1):  # noqa: N802 (pymodbus's name)
            values = registers(self.device, time.monotonic() - started)
            return [values[i] if 0 <= i < REGISTER_COUNT else 0 for i in range(address - 1, address - 1 + count)]

        def validate(self, address, count=1):
            return 1 <= address and address - 1 + count <= REGISTER_COUNT

    devices = {address: ModbusDeviceContext(hr=Registers(address)) for address in range(first, last + 1)}
    return ModbusServerContext(devices=devices, single=False)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", required=True, help="the serial port, such as /dev/ttyUSB0 or COM4")
    parser.add_argument("--baud", type=int, default=9600)
    parser.add_argument("--first", type=int, default=FIRST_ADDRESS, help="the lowest address that answers")
    parser.add_argument("--last", type=int, default=LAST_ADDRESS, help="the highest address that answers")
    args = parser.parse_args(argv)
    if not FIRST_ADDRESS <= args.first <= args.last <= LAST_ADDRESS:
        parser.error(f"--first and --last must satisfy {FIRST_ADDRESS} <= first <= last <= {LAST_ADDRESS}")
    try:
        from pymodbus.server import StartSerialServer
    except ImportError:
        print("pymodbus is missing: pip install -r tooling/hardware/requirements.txt", file=sys.stderr)
        return 1
    print(f"Answering Modbus RTU addresses {args.first}-{args.last} on {args.port} at {args.baud} baud")
    StartSerialServer(context=build_context(args.first, args.last, time.monotonic()), port=args.port,
                      baudrate=args.baud, framer="rtu")
    return 0


if __name__ == "__main__":
    sys.exit(main())
