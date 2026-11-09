# The seven open timesheet lines on submitted dates — investigation, 8 November 2026

> **9 November 2026: CLEARED BY THE RESET, PRESERVED IN THE ARCHIVE.**
> - The owner decided the attendance and timesheet reset (FORMS-RESET-1), which covers these seven lines by name.
> - They were read unchanged (same row hashes) just before it ran.
> - The reset removed them from the operational system, with every other form record.
> - A separate decryption of the encrypted archive found all seven in it
>   (`/var/backups/eje/forms-reset-archive-2026-11-09T20-19-45Z/`, 7/7).
> - Details: `docs/forms-reset-2026-11-09.md`. The investigation below is kept as written.

Asked for by the owner on 8 November 2026 after the v1.8.0 report. **Read only: none of these records, nor the
submitted timesheets, was changed, moved, merged, submitted, processed or deleted.** Each line was read with its row
hash (`md5` of the whole row) before the work, before the v1.9.0 release and after it: byte-identical all three
times. They await the owner's review.

## What they are

Under v1.8.0 (REPEAT-DATES-1) a submitted timesheet holds its own LINES, not its dates: a line typed on a date that
is already in a submitted timesheet is an ordinary open line and would be carried by the next timesheet that covers
the date. These seven lines are such lines. None of them is in any submitted snapshot (so none has been paid or sent
to Finance — there are no Finance packages for October or November, and no payroll submission holds them).

Both accounts are **demonstration accounts** (Mike Technician, David Technician), and every line was typed AFTER the
timesheet covering its date had been submitted.

| # | Employee | Line (id) | Work date | Customer / site | OT | D/T | Km (int/cust) | Typed | Submitted timesheet holding the date (period, sent) | Submitted line(s) on that date | Assessment |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | David Technician | `379be25c-fb41-4250-99b4-7540d628991a` | Mon 26 Oct 2026 | Workshop | 4.00 | 0.00 | 0 / 0 | 4 Nov 13:40 UTC | `53b92c93…` 26 Oct – 1 Nov, sent 1 Nov 05:07 | Workshop, OT 1 | Unclear — manual review: same site, different hours; possibly a correction typed as a new line |
| 2 | David Technician | `31d8f672-00e8-412c-82a7-17bd05ce4be6` | Tue 27 Oct 2026 | (no customer) | 5.00 | 0.00 | 0 / 0 | 4 Nov 13:41 UTC | `53b92c93…` 26 Oct – 1 Nov | "fds", OT 3 | Unclear — manual review: no customer named; not the same as the submitted line |
| 3 | David Technician | `7dfd46ed-f808-44cc-b27f-466af28ba29a` | Sun 1 Nov 2026 | (no customer) | 0.00 | 8.00 | 0 / 0 | 4 Nov 13:38 UTC | `53b92c93…` 26 Oct – 1 Nov | none | Unclear — appears to be additional work not in the submission, but no customer is named |
| 4 | Mike Technician | `54dcafd8-0ca5-4e09-8a3b-f3cf76321a1b` | Mon 26 Oct 2026 | Workshop | 2.00 | 0.00 | 0 / 0 | 5 Nov 18:30 UTC | `e412b3ea…` 26 Oct – 4 Nov, sent 4 Nov 18:08 | "asdfgf", 0 h | Unclear — manual review: test-like data on the demonstration account |
| 5 | Mike Technician | `6a8638d9-bc3c-4b33-a1ce-d60edc8c30d2` | Mon 26 Oct 2026 | Auto industrial | 0.00 | 2.00 | 0 / 0 | 5 Nov 18:30 UTC | `e412b3ea…` 26 Oct – 4 Nov | "asdfgf", 0 h | Appears additional (a named customer not on the submitted line) — confirm |
| 6 | Mike Technician | `977b2734-a318-4ea7-9d7a-4d97c9e7ee34` | Tue 27 Oct 2026 | Brelko | 2.00 | 0.00 | 0 / 0 | 6 Nov 16:17 UTC | `e412b3ea…` 26 Oct – 4 Nov | (no customer), OT 1 | Appears additional (a named customer) — confirm |
| 7 | Mike Technician | `7d6e19ff-90d2-4e5b-ba94-b1159b3d66fa` | Wed 4 Nov 2026 | test | 2.00 | 0.00 | 0 / 0 | 6 Nov 16:18 UTC | `e412b3ea…` 26 Oct – 4 Nov | two empty lines, 0 h | Unclear — test-like data ("test") |

No line is an exact duplicate of a submitted line (customer and hours differ in every case). None has a call-out
amount. Full ids, hashes and the submitted lines' details: the read-only investigation output kept with the release
record (`seven-before.txt` / `seven-after.txt`, scratch evidence).

## What happens to them if nothing is done

They stay open lines. If either account completes a timesheet whose dates cover them, they are in it (and the
Timesheets day shows, beside them, which lines were already submitted for that date). If they are not wanted, the
person removes them from their own Timesheets page; if they are wanted, they are submitted with the next timesheet.
The system does neither by itself.

## Row hashes (unchanged before the work, before the release and after it)

| Line | Row md5 |
|---|---|
| `379be25c-fb41-4250-99b4-7540d628991a` | `25ee5cd1fbd30fe3fb763e4a7b6e8ec1` |
| `54dcafd8-0ca5-4e09-8a3b-f3cf76321a1b` | `58ec07193d7fc726f845735a33d038d9` |
| `6a8638d9-bc3c-4b33-a1ce-d60edc8c30d2` | `4230faa08f14664d659408ba25c82cb5` |
| `31d8f672-00e8-412c-82a7-17bd05ce4be6` | `8b20b073813ef0b5aed1fde654a39f8c` |
| `977b2734-a318-4ea7-9d7a-4d97c9e7ee34` | `a8b42e04dfee9fd05b88571aea7e3f1f` |
| `7dfd46ed-f808-44cc-b27f-466af28ba29a` | `70c14d07bfe607fa5a41433d8521a022` |
| `7d6e19ff-90d2-4e5b-ba94-b1159b3d66fa` | `d6968199ae529141187a482e1677ae77` |
