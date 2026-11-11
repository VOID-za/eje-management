# Physical device checklist — Android phone and rugged tablet (#82)

**Status: NOT STARTED (11 November 2026, on v1.10.0 `afa3efa`).** Nothing on this page has been done on a physical device. The automated browser suites
(desktop, tablet and phone sizes in CI) are emulation, not a substitute. Issue #82 stays open until the owner (or
a tester the owner names) has completed this list on both devices and recorded the result.

## Before you start

- **Where:** production, https://eje.syncza.co.za, in demonstration mode (email is `refuse`: nothing is emailed or
  sent by WhatsApp).
- **Who:** the demonstration accounts only — `master@eje-demo.local` (Senior Tech), `coordinator@eje-demo.local`
  (Office) and `technician2@eje-demo.local` (Technician). Do not sign in as a real person.
- **What you may create:** forms and records that a real tester would make in a real testing cycle. **Do not invent
  jobs, attendance or timesheets just to tick a box.** Where a step says *(test only)*, do it only if a demonstration
  job or form that genuinely needs it exists. Otherwise mark it **N/A — nothing to test on** and say so in Notes.
- **Submitted forms are final.** A submitted timesheet cannot be changed afterwards (11 November 2026). Before you
  press Submit, check every line, and only submit a form you would really send.
- **Record each device once at the top**, then fill in the tables. A row is **Pass**, **Fail** or **N/A**. For a
  Fail, add a screenshot (the file name in the Screenshot column) and one sentence in Notes saying what happened.

| | Device 1 — Android phone | Device 2 — rugged tablet |
|---|---|---|
| Make and model | | |
| Android version | | |
| Browser and version | | |
| Screen size / resolution | | |
| Tester | | |
| Date | | |

Use one copy of the tables per device (Phone: **P**, Tablet: **T**).

## 1. Login and navigation

| # | Check | P | T | Screenshot | Notes |
|---|---|---|---|---|---|
| 1.1 | Sign in as the Technician; the dashboard opens with your name | | | | |
| 1.2 | Sign out; you return to Sign in, and Back does not reopen the app | | | | |
| 1.3 | Sign in as the Office: the menu shows the Office items (Jobs, Users, EJE Monthly Forms, Administration…) and not Timesheets | | | | |
| 1.4 | Sign in as the Senior Tech: the menu shows Timesheets, My Monthly Forms and Administration | | | | |
| 1.5 | Close the browser fully, open it again: you are still signed in (session kept) | | | | |
| 1.6 | Lock the device for 5 minutes, unlock: the page still works without signing in again | | | | |
| 1.7 | Every menu item opens its page within a few seconds, with no error | | | | |
| 1.8 | Browser Back and Forward move between pages correctly; nothing is lost or submitted twice | | | | |
| 1.9 | The menu (drawer) opens and closes; nothing behind it can be tapped by accident | | | | |

## 2. Jobcards

| # | Check | P | T | Screenshot | Notes |
|---|---|---|---|---|---|
| 2.1 | Jobs list loads; filters and search work; rows are readable | | | | |
| 2.2 | Open a job: every section (customer, machine, schedule, parts, checklist) is readable | | | | |
| 2.3 | *(test only)* As the Office, create a job for a demonstration customer — only if you need one for the steps below | | | | |
| 2.4 | As the Technician, accept an assigned job | | | | |
| 2.5 | Open an attachment (photo or PDF) and close it again | | | | |
| 2.6 | Update job details (notes, parts booked in: Part number, Description, Quantity in that order) and save | | | | |
| 2.7 | Complete a checklist: every item can be ticked or answered; the keyboard does not hide the field being typed in | | | | |
| 2.8 | Job completion: the customer-signature screen fills the screen, the signature can be drawn smoothly, cleared and saved | | | | |
| 2.9 | Schedule Date (Office): the date picker opens, a date is set and saved | | | | |

## 3. Attendance

| # | Check | P | T | Screenshot | Notes |
|---|---|---|---|---|---|
| 3.1 | Open Attendance: today's day and the controls are visible without zooming | | | | |
| 3.2 | Record a day (status and note); it is kept after reloading the page | | | | |
| 3.3 | *(test only)* Complete and submit attendance from My Monthly Forms for a real period of the test cycle | | | | |
| 3.4 | Buttons, the status dropdown and the date controls are large enough to tap with a gloved finger (tablet) | | | | |
| 3.5 | Portrait and landscape: nothing is cut off, nothing overlaps | | | | |

## 4. Timesheets

| # | Check | P | T | Screenshot | Notes |
|---|---|---|---|---|---|
| 4.1 | Open My Monthly Forms: the page loads, its sections are readable | | | | |
| 4.2 | Open Timesheets: each day is a block; Add line opens a line | | | | |
| 4.3 | Enter a work line (customer or Workshop, OT, D/T, km); it saves without pressing anything else | | | | |
| 4.4 | Leave the page and come back: the draft line is still there | | | | |
| 4.5 | Turn on airplane mode, type a line, turn it off: the line is saved once, not twice | | | | |
| 4.6 | Complete the timesheet: the preview PDF opens and reads correctly | | | | |
| 4.7 | Withdraw the completed (not submitted) timesheet, correct it, complete it again | | | | |
| 4.8 | *(test only)* Submit timesheet and attendance together to the office | | | | |
| 4.9 | History: the submission is listed; its PDF opens exactly as submitted | | | | |
| 4.10 | After submission, the submitted timesheet offers no way to change it | | | | |

## 5. Documents and usability

| # | Check | P | T | Screenshot | Notes |
|---|---|---|---|---|---|
| 5.1 | Open a PDF (job card, delivery note, timesheet): it opens, scrolls and zooms | | | | |
| 5.2 | Open a technical document from the Technical Library | | | | |
| 5.3 | Upload a photo with the camera, and one from the gallery; both appear on the job | | | | |
| 5.4 | Signatures draw smoothly; the page does not scroll while signing | | | | |
| 5.5 | Scrolling is smooth on long pages (jobs list, a long timesheet) | | | | |
| 5.6 | Pinch-zoom works where content is small, and the page returns to normal afterwards | | | | |
| 5.7 | The on-screen keyboard: numeric fields open a number keyboard; the field typed in stays visible | | | | |
| 5.8 | Every dropdown opens and closes; the chosen value shows | | | | |
| 5.9 | Every date picker opens, a date is chosen, the picker closes | | | | |
| 5.10 | Portrait and landscape on every page above: nothing cut off, no sideways scrolling | | | | |
| 5.11 | Every button and link can be hit first time with a finger (with gloves on the tablet) | | | | |
| 5.12 | Sticky headers, footers and panels never cover a field, a button or the last row | | | | |
| 5.13 | Dark mode (if the device uses it): text is readable everywhere, including the Delivery Note dates | | | | |
| 5.14 | Outdoors in daylight (tablet): the screen is readable | | | | |

## Result

| | Phone | Tablet |
|---|---|---|
| Rows passed | | |
| Rows failed | | |
| Rows N/A | | |
| Signed off by | | |

Send the completed checklist, with the failure screenshots, to be recorded on issue #82. A failure becomes its own
issue. #82 is closed only when both devices pass, or every failure has an owner decision.
