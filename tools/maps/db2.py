"""Reads the game's database tables (DB2, formats WDC3 to WDC5) into rows.

    rows = read_db2(data, ["PhaseID", "UiMapArtID"], relation="UiMapID")

`fields` names the inline fields in order, as WoWDBDefs lists them for the
table's layout hash (leaving out non-inline ID and relation columns).
`strings` names the inline fields that hold strings. Each row has "ID", the
named fields, and `relation` if the table has a relationship map.
Encrypted sections are skipped.
"""
import struct

HEADER = struct.Struct("<9IHH7I")
SECTION = struct.Struct("<Q8I")
STORAGE = struct.Struct("<HHIIIII")

NONE, BITPACKED, COMMON, PALLET, PALLET_ARRAY, BITPACKED_SIGNED = range(6)


def read_db2(data, fields, strings=(), relation=None, layout=None):
    magic = data[:4]
    if magic not in (b"WDC3", b"WDC4", b"WDC5"):
        raise ValueError(f"unsupported DB2 format {magic!r}")
    pos = 4 + (4 + 128 if magic == b"WDC5" else 0)
    (record_count, field_count, record_size, string_table_size, table_hash, layout_hash, min_id, max_id,
     locale, flags, id_index, total_field_count, bitpacked_offset, lookup_columns, storage_size,
     common_size, pallet_size, section_count) = HEADER.unpack_from(data, pos)
    pos += HEADER.size
    if layout is not None and layout_hash != layout:
        raise ValueError(f"layout {layout_hash:08X}, expected {layout:08X}: the table changed")
    if len(fields) != total_field_count:
        raise ValueError(f"{total_field_count} fields in the file, {len(fields)} named")
    sections = [SECTION.unpack_from(data, pos + n * SECTION.size) for n in range(section_count)]
    pos += section_count * SECTION.size
    pos += field_count * 4  # field structure: the storage info below says it all
    storage = [STORAGE.unpack_from(data, pos + n * STORAGE.size) for n in range(total_field_count)]
    pos += total_field_count * STORAGE.size

    # Pallets and common values, in field order.
    pallets, commons = {}, {}
    p = pos
    for n, (_, _, extra, kind, *_rest) in enumerate(storage):
        if kind in (PALLET, PALLET_ARRAY):
            pallets[n] = struct.unpack_from(f"<{extra // 4}I", data, p)
            p += extra
    p = pos + pallet_size
    for n, (_, _, extra, kind, *_rest) in enumerate(storage):
        if kind == COMMON:
            pairs = struct.unpack_from(f"<{extra // 4}I", data, p)
            commons[n] = dict(zip(pairs[0::2], pairs[1::2]))
            p += extra

    rows = []
    for (key_hash, offset, count, strings_size, _records_end, id_list_size, relation_size,
         offset_map_count, copy_count) in sections:
        if key_hash or count == 0:
            continue  # encrypted, or empty
        if flags & 1:
            raise ValueError("sparse tables aren't supported")
        records = offset
        p = offset + count * record_size + strings_size
        ids = struct.unpack_from(f"<{id_list_size // 4}I", data, p) if id_list_size else None
        p += id_list_size
        copies = [struct.unpack_from("<II", data, p + 8 * n) for n in range(copy_count)]
        p += 8 * copy_count + 6 * offset_map_count
        related = {}
        if relation_size:
            entries = struct.unpack_from("<I", data, p)[0]
            for n in range(entries):
                foreign, index = struct.unpack_from("<II", data, p + 12 + 8 * n)
                related[index] = foreign

        section_rows = []
        for index in range(count):
            start = records + index * record_size
            bits = int.from_bytes(data[start:start + record_size], "little")
            raw = []
            for n, (offset_bits, size_bits, _extra, kind, v1, _v2, v3) in enumerate(storage):
                value = (bits >> offset_bits) & ((1 << size_bits) - 1) if size_bits else 0
                if kind == BITPACKED_SIGNED and size_bits and value >> (size_bits - 1):
                    value -= 1 << size_bits
                elif kind == PALLET:
                    value = pallets[n][value]
                elif kind == PALLET_ARRAY:
                    value = list(pallets[n][value * v3:(value + 1) * v3])
                raw.append(value)
            row = {}
            row_id = ids[index] if ids else raw[id_index]
            for n, name in enumerate(fields):
                value = raw[n]
                kind, v1 = storage[n][3], storage[n][4]
                if kind == COMMON:
                    value = commons[n].get(row_id, v1)
                if name in strings:
                    # An offset from the field's own position to the string.
                    at = start + storage[n][0] // 8 + value
                    value = data[at:data.index(b"\0", at)].decode("utf-8", "replace")
                row[name] = value
            row["ID"] = row_id
            if relation is not None:
                row[relation] = related.get(index)
            section_rows.append(row)
        by_id = {row["ID"]: row for row in section_rows}
        for new_id, source in copies:
            if source in by_id:
                section_rows.append({**by_id[source], "ID": new_id})
        rows.extend(section_rows)
    return rows
