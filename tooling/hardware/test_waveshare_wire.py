"""Exercise the embedded wire codec against the platform's real protobuf schema."""
import ctypes as c
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/simulators"))
import sparkplug_b_pb2 as sp


class Metric(c.Structure):
    _fields_ = [("name", c.c_char * 40), ("string_value", c.c_char * 64),
                ("alias", c.c_uint64), ("datatype", c.c_uint64), ("value", c.c_uint64),
                ("has_alias", c.c_bool), ("has_value", c.c_bool)]


class Payload(c.Structure):
    _fields_ = [("timestamp", c.c_uint64), ("seq", c.c_uint64),
                ("has_timestamp", c.c_bool), ("has_seq", c.c_bool),
                ("uuid", c.c_char * 65), ("count", c.c_size_t), ("metrics", Metric * 10)]


class WireCodecTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        library = Path(cls.directory.name) / "codec.so"
        subprocess.run(["rtk", "proxy", "cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                        "-shared", "-fPIC", str(ROOT / "firmware/waveshare-audio/main/sparkplug_wire.c"),
                        "-o", str(library)], check=True)
        cls.lib = c.CDLL(str(library))
        cls.lib.wave_sp_decode.argtypes = [c.c_void_p, c.c_size_t, c.POINTER(Payload)]
        cls.lib.wave_sp_decode.restype = c.c_bool
        cls.lib.wave_sp_encode.argtypes = [c.POINTER(Payload), c.c_void_p, c.c_size_t]
        cls.lib.wave_sp_encode.restype = c.c_size_t

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def decode(self, data):
        result = Payload()
        okay = self.lib.wave_sp_decode(data, len(data), c.byref(result))
        return okay, result

    def command(self, datatype=sp.Boolean, field="boolean_value", value=True):
        p = sp.Payload(timestamp=1791234567890, seq=9, uuid="command-123")
        m = p.metrics.add(name="Power", datatype=datatype, alias=1)
        setattr(m, field, value)
        return p

    def test_platform_commands_and_embedded_telemetry_roundtrip(self):
        p = self.command()
        p.metrics.add(name="Color", datatype=sp.String, alias=2, string_value="#123456")
        p.metrics.add(name="Brightness", datatype=sp.Int32, alias=4, int_value=37)
        okay, embedded = self.decode(p.SerializeToString())
        self.assertTrue(okay)
        self.assertEqual(embedded.uuid, b"command-123")
        self.assertEqual(embedded.metrics[2].value, 37)
        buffer = c.create_string_buffer(2048)
        length = self.lib.wave_sp_encode(c.byref(embedded), buffer, len(buffer))
        self.assertGreater(length, 0)
        self.assertEqual(sp.Payload.FromString(buffer.raw[:length]), p)

    def test_birth_and_death_bdseq(self):
        p = sp.Payload(timestamp=1791234567890)
        p.metrics.add(name="bdSeq", datatype=sp.Int64, long_value=255)
        okay, embedded = self.decode(p.SerializeToString())
        self.assertTrue(okay)
        self.assertEqual(embedded.metrics[0].value, 255)

    def test_runtime_command_without_alias_seq_or_uuid(self):
        p = sp.Payload(timestamp=1791234567890)
        p.metrics.add(name="Power", timestamp=1791234567890, datatype=sp.Boolean, boolean_value=True)
        okay, embedded = self.decode(p.SerializeToString())
        self.assertTrue(okay)
        self.assertFalse(embedded.has_seq)
        self.assertFalse(embedded.metrics[0].has_alias)
        self.assertEqual(embedded.metrics[0].name, b"Power")
        self.assertEqual(embedded.metrics[0].value, 1)

    def test_rejects_mismatched_missing_or_unsupported_values(self):
        for datatype, field, value in [(sp.Boolean, "int_value", 1), (sp.Int32, "string_value", "2"),
                                       (sp.Float, "float_value", 1.0), (sp.Boolean, "long_value", 1)]:
            with self.subTest(datatype=datatype):
                self.assertFalse(self.decode(self.command(datatype, field, value).SerializeToString())[0])
        p = self.command()
        p.metrics[0].ClearField("boolean_value")
        self.assertFalse(self.decode(p.SerializeToString())[0])

    def test_rejects_null_historical_and_transient_controls(self):
        for flag in ["is_null", "is_historical", "is_transient"]:
            p = self.command()
            setattr(p.metrics[0], flag, True)
            self.assertFalse(self.decode(p.SerializeToString())[0])

    def test_rejects_overflow_truncation_duplicates_and_oversize(self):
        data = self.command().SerializeToString()
        for corrupt in [data[:-1], data+b"\x08\x01", b"\x08"+b"\xff"*10,
                        b"\x12\xff\xff\xff\xff\x07", data+b"\x00", b"x"*2049]:
            self.assertFalse(self.decode(corrupt)[0])
        p = self.command()
        for _ in range(10):
            p.metrics.add(name="Power", datatype=sp.Boolean, boolean_value=True)
        self.assertFalse(self.decode(p.SerializeToString())[0])
        p = self.command(sp.String, "string_value", "x"*64)
        self.assertFalse(self.decode(p.SerializeToString())[0])

    def test_encode_cannot_overrun_output_buffer(self):
        okay, embedded = self.decode(self.command().SerializeToString())
        self.assertTrue(okay)
        buffer = c.create_string_buffer(b"sentinel", 9)
        self.assertEqual(self.lib.wave_sp_encode(c.byref(embedded), buffer, 1), 0)
        self.assertEqual(buffer.raw[1:], b"entinel\x00")


if __name__ == "__main__":
    unittest.main()
