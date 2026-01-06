from __future__ import annotations

from pathlib import Path

from dbfread import DBF


def inspect_dbf(path: Path) -> None:
    print(f"\n=== {path} ===")
    if not path.exists():
        print("Missing")
        return

    table = None
    last_err: Exception | None = None
    for encoding in ("cp1252", "utf-8", "latin-1"):
        try:
            table = DBF(str(path), load=False, encoding=encoding, char_decode_errors="replace")
            print("encoding:", encoding)
            break
        except Exception as exc:  # noqa: BLE001
            last_err = exc

    if table is None:
        print("Failed to read:", last_err)
        return

    fields = [f.name for f in table.fields]
    num_records = getattr(getattr(table, "header", None), "numrecords", None)
    if num_records is None:
        # Fallback: dbfread API varies; len(table) would iterate, so avoid it.
        num_records = "(unknown)"

    print("numrecords:", num_records)
    print(f"fields (count={len(fields)}):")
    print(fields)

    try:
        first = next(iter(table))
    except StopIteration:
        print("(no records)")
        return

    items = list(first.items())[:12]
    print("sample:", dict(items))


def main() -> None:
    root = Path(__file__).resolve().parents[1]

    dbf_paths = [
        root / "Commune" / "CommunesPromethee.dbf",
        root / "Commune" / "déparetements.dbf",
        root / "Commune" / "zonePromethee.dbf",
        root / "CLC" / "CLC-12-Communes-04.dbf",
        root / "geo" / "shp" / "carro zone.dbf",
        root / "geo" / "shp" / "depar83.dbf",
        root / "geo" / "Data" / "clc_promethee.dbf",
        root / "geo" / "Data" / "DFCI" / "CARRO_DFCI_2x2_L93" / "CARRO_DFCI_2X2_L93.dbf",
    ]

    for p in dbf_paths:
        inspect_dbf(p)


if __name__ == "__main__":
    main()
