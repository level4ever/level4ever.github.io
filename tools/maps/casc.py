"""Reads files from a local World of Warcraft install (Blizzard's CASC
storage) by file data ID. Read-only: it never writes to the install.

    storage = Storage("C:/Program Files (x86)/World of Warcraft", "wow_classic_beta")
    data = storage.read_id(1957206)  # DBFilesClient/UiMap.db2

Only what's needed for the map art: local indexes and archives, BLTE
(uncompressed and zlib blocks), the encoding table and the root manifest.
Encrypted blocks are skipped (read returns None for those files).
"""
import os
import struct
import zlib


def _build_info(install, product):
    """The .build.info row for a product, as {field: value}."""
    with open(os.path.join(install, ".build.info"), encoding="utf-8") as f:
        lines = [line.rstrip("\n") for line in f if line.strip()]
    names = [column.split("!")[0] for column in lines[0].split("|")]
    for line in lines[1:]:
        row = dict(zip(names, line.split("|")))
        if row.get("Product") == product:
            return row
    raise ValueError(f"{product} isn't in {install}/.build.info")


def _config(data_dir, key):
    with open(os.path.join(data_dir, "config", key[0:2], key[2:4], key), encoding="utf-8") as f:
        values = {}
        for line in f:
            if " = " in line:
                name, value = line.strip().split(" = ", 1)
                values[name] = value.split()
        return values


def blte(data):
    """Decodes a BLTE-encoded file. None if any block is encrypted."""
    if data[:4] != b"BLTE":
        raise ValueError("not BLTE")
    header_size = struct.unpack_from(">I", data, 4)[0]
    if header_size == 0:
        chunks = [(len(data) - 8, None)]
        pos = 8
    else:
        count = struct.unpack_from(">I", data, 8)[0] & 0xFFFFFF
        chunks = [struct.unpack_from(">II", data, 12 + 24 * n) for n in range(count)]
        pos = header_size
    out = []
    for compressed_size, _ in chunks:
        chunk = data[pos:pos + compressed_size]
        pos += compressed_size
        mode = chunk[:1]
        if mode == b"N":
            out.append(chunk[1:])
        elif mode == b"Z":
            out.append(zlib.decompress(chunk[1:]))
        elif mode == b"E":
            return None
        elif mode == b"F":
            out.append(blte(chunk[1:]))
        else:
            raise ValueError(f"unknown BLTE block mode {mode!r}")
    return b"".join(out)


class Storage:
    def __init__(self, install, product):
        self.data_dir = os.path.join(install, "Data")
        info = _build_info(install, product)
        self.version = info.get("Version")
        build = _config(self.data_dir, info["Build Key"])
        self._index = self._read_indexes()
        encoding_ekey = bytes.fromhex(build["encoding"][1])
        self._encoding = self._read_encoding(self._read_ekey(encoding_ekey))
        self._root = self._read_root(self.read_ckey(bytes.fromhex(build["root"][0])))

    # Local indexes: the first 9 bytes of an encoded key -> where it is.
    def _read_indexes(self):
        folder = os.path.join(self.data_dir, "data")
        latest = {}
        for name in os.listdir(folder):
            if name.endswith(".idx") and len(name) == 14:
                bucket, version = int(name[0:2], 16), int(name[2:10], 16)
                if version >= latest.get(bucket, (-1, ""))[0]:
                    latest[bucket] = (version, name)
        index = {}
        for _, name in latest.values():
            with open(os.path.join(folder, name), "rb") as f:
                raw = f.read()
            entries_size = struct.unpack_from("<I", raw, 0x20)[0]
            for pos in range(0x28, 0x28 + entries_size, 18):
                key = raw[pos:pos + 9]
                packed = int.from_bytes(raw[pos + 9:pos + 14], "big")
                size = struct.unpack_from("<I", raw, pos + 14)[0]
                index.setdefault(key, (packed >> 30, packed & 0x3FFFFFFF, size))
        return index

    def _read_ekey(self, ekey):
        found = self._index.get(ekey[:9])
        if not found:
            return None
        archive, offset, size = found
        with open(os.path.join(self.data_dir, "data", f"data.{archive:03d}"), "rb") as f:
            f.seek(offset + 30)  # past the archive's own record header
            return blte(f.read(size - 30))

    # Encoding: content key -> encoded keys.
    @staticmethod
    def _read_encoding(data):
        if data[:2] != b"EN":
            raise ValueError("bad encoding file")
        ckey_size, ekey_size = data[3], data[4]
        page_kb = struct.unpack_from(">H", data, 5)[0]
        page_count = struct.unpack_from(">I", data, 9)[0]
        espec_size = struct.unpack_from(">I", data, 18)[0]
        pos = 22 + espec_size + page_count * 32  # past the especs and the page index
        table = {}
        for page in range(page_count):
            start = pos + page * page_kb * 1024
            p = start
            end = start + page_kb * 1024
            while p < end:
                count = data[p]
                if count == 0:
                    break
                ckey = data[p + 6:p + 6 + ckey_size]
                table[ckey] = data[p + 6 + ckey_size:p + 6 + ckey_size + ekey_size]
                p += 6 + ckey_size + ekey_size * count
        return table

    def read_ckey(self, ckey):
        ekey = self._encoding.get(ckey)
        return self._read_ekey(ekey) if ekey else None

    # Root: file data ID -> content key.
    @staticmethod
    def _read_root(data):
        if data[:4] != b"TSFM":
            raise ValueError("unsupported root format")
        first, second = struct.unpack_from("<II", data, 4)
        if first in (20, 24) and second in (1, 2):
            header_size, version = first, second
        else:
            header_size, version = 12, 0
        files = {}
        pos = header_size
        enus = 0x2
        while pos < len(data):
            if version >= 2:
                count, locale, flags1, flags2 = struct.unpack_from("<IIII", data, pos)
                content = flags1 | flags2 | (data[pos + 16] << 17)
                pos += 17
            else:
                count, content, locale = struct.unpack_from("<III", data, pos)
                pos += 12
            fdids = []
            fdid = -1
            for delta in struct.unpack_from(f"<{count}i", data, pos):
                fdid += 1 + delta
                fdids.append(fdid)
            pos += 4 * count
            ckeys = [data[pos + 16 * n:pos + 16 * n + 16] for n in range(count)]
            pos += 16 * count
            if not content & 0x10000000:
                pos += 8 * count  # name hashes, not needed
            if locale & enus or locale == 0xFFFFFFFF or locale == 0:
                for n, fdid in enumerate(fdids):
                    files.setdefault(fdid, ckeys[n])
        return files

    def read_id(self, fdid):
        ckey = self._root.get(fdid)
        return self.read_ckey(ckey) if ckey else None
