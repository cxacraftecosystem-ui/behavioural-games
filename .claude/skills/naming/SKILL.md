---
name: naming
description: The one naming convention for generated data file names in SHRIII Behavioural Games — the same grammar as the Field Repository / Design Workshop convention, with this product's portal word and entities. Load BEFORE generating any name for data on the web console, the card-sort tablet, the kiosk, the backend or scripts: CSV/Parquet exports, validation reports and their figures and tables, snapshot downloads, device exports, backups and release names. Also load it when reviewing a change that adds or alters one.
---

# Naming: one convention for every generated name

This is the sibling portals' convention (owner correction, 18 Oct 2026;
`C:/dev/IIT/docs/conventions/NAMING_2026-10-18.md`) applied to this product. The portals will merge,
so a file downloaded from any of them reads the same way.

## Grammar for file names

```
BehaviouralGames_Entity_Date[_Time]_Subject_What[_Sequence][_n].ext
```

- `_` separates fields. `-` joins the words inside a field. Nothing else is a separator: no spaces,
  middle dots, colons, `+`, `&`, brackets, or dots other than the one before the extension.
- Fields always appear in this order. Leave out a field that is unknown. Never write `Unknown`, `NA`, a
  placeholder such as `study` or `device`, or a guess.
- **Portal:** `BehaviouralGames`. Always present.
- **Entity:** `Dataset` (a tabular export), `Study`, `Snapshot`, `Card-Sort`, `Kiosk`, `Game-Config`,
  `Content`, `Audit-Log`, `Database`, `Kiosk-App`.
- **Date:** `YYYY-MM-DD` in IST — the generation day for exports, reports and backups; the capture day
  for anything captured.
- **Time:** `HHMM` in IST, 24-hour, only for names that can repeat within a day (exports, device
  exports). Never seconds.
- **Subject:** the record's code or name — a study code (`PILOT-1`), a dataset name
  (`Validation-Runs`), a device id. **Never a participant identifier, an email or a phone number.**
- **What:** `Export`, `Validation-Report`, `Figure`, `Table`, `Snapshot`, `Backup`, `Release-Build`.
- **Sequence:** a figure number zero-padded to two digits (`03`), a table id, a snapshot id, a version
  (`v0.1.0`).
- **`n`:** `_2`, `_3` only when names collide inside one folder or zip, assigned in a fixed order.

## Characters, case, length

- ASCII only: `[A-Za-z0-9-]` inside a field, `_` between fields. Diacritics are stripped (NFKD).
- Title-Case each word; codes, acronyms and any word containing a digit keep their own case.
- At most 150 characters; the Subject is cut to 40 first. Never cut Portal, Entity, Date, Time, What,
  Sequence or the extension.

## Exempt

- **Source files kept in the repository under their own path** — the game-config editor downloads
  `content/games/<file>.json` under its repository file name, because the next step is to commit it
  there. That is a source file, not a data name.
- Scratch temp files, parts inside a zip or a report, and browser storage keys.

## Examples

- `BehaviouralGames_Dataset_2026-10-21_1435_Validation-Runs_Export.parquet`
- `BehaviouralGames_Study_2026-11-01_PILOT-1_Validation-Report.html`
- `BehaviouralGames_Study_2026-11-01_PILOT-1_Figure_03.svg`
- `BehaviouralGames_Study_2026-11-01_PILOT-1_Table_Reliability.csv`
- `BehaviouralGames_Snapshot_2026-11-01_PILOT-1_Snapshot_<snapshot-id>.parquet`
- `BehaviouralGames_Card-Sort_2026-11-01_1430_TAB-07_Export.json`

## How to apply

1. Never format a name inline. Call the runtime's single helper: web `frontend/apps/web/src/lib/naming.ts`
   (`dataFileName`, `nameField`, `istStamp`; `lib/export` `exportFileName` wraps it for tabular
   exports), card-sort `frontend/apps/card-sort-app/src/naming.ts` (`exportFileName`). If a runtime has
   no helper yet (backend, kiosk logs, scripts), add one rather than hand-building the string.
2. Add a golden row for every new kind of name to the helper's test (`src/lib/naming.test.ts`).
3. A server download sets the readable name with `Content-Disposition` (`filename=` ASCII plus
   `filename*=UTF-8''`); never rename stored objects to apply it.
