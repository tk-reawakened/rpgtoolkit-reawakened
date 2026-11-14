import struct
import unittest

import rpgtk_formats as formats


class MainFileExtensionTests(unittest.TestCase):
    def test_encoder_tracks_layout_position_for_optional_extensions(self):
        value = lambda field, kind: "" if kind == "str" else 0
        encoded = formats.encode(formats.parse_gam, value)
        reader = formats.Reader(encoded)
        formats.parse_gam(reader)
        self.assertTrue(reader.at_eof())

    def test_parser_reads_package_audio_and_input_blocks_in_order(self):
        value = lambda field, kind: "" if kind == "str" else 0
        base = formats.encode(formats.parse_gam, value)
        package = b"TKRPLUG\0" + struct.pack("<H", 0)
        tracks = b"".join(name + b"\0" + struct.pack("<H", 1) for name in
                          (b"music", b"sfx", b"ambience", b"voice", b"ui"))
        audio = b"TRKAUD\0" + struct.pack("<H", 5) + tracks + struct.pack("<H", 32) + b"\0"
        input_settings = b"TRKINP\0" + bytes((1, 1)) + struct.pack("<H", 0)
        reader = formats.Reader(base + package + audio + input_settings)

        formats.parse_gam(reader)

        self.assertTrue(reader.at_eof())
        markers = [field for _, _, field, _ in reader.trace if field.endswith("marker")]
        self.assertEqual(markers, [
            "TKR package-list marker",
            "TKR audio-settings marker",
            "TKR input-settings marker",
        ])


if __name__ == "__main__":
    unittest.main()
