# Usability test — employee app (WP9)

**Purpose:** check that pilot employees can do the everyday tasks on their own phones without
help. This is the WP9 acceptance check (guide §24): "Usability test tasks completed by pilot
employees on their phones."

**Who runs it:** one facilitator from HR, plus one note-taker if possible.

## Before the test

1. **Choose the participants.** Pick 5–8 pilot employees across ages, roles and phones:
   - at least one mid-range Android phone;
   - at least one person who usually uses the phone in Bangla;
   - at least one line manager, for task 6.
2. **Check each participant's login.** Each has an active login linked to their employee
   record, with their company code, e-mail or mobile number, and a password.
3. **Set the office location.** The office has its location (geo-fence) set for the branch.
4. **Share the address.** Give participants the app address (HTTPS). Do not explain the app.
5. **Prepare data.** For task 6, make sure one leave request is waiting for the manager.

## How to run it

- Give one task at a time, read aloud as written below. Do not show where to tap.
- If the participant asks for help, say: "What would you try?" Help only after 2 minutes, and
  record the task as **"help needed"**.
- For each task, note the result (**done**, **done with difficulty**, **help needed** or
  **not done**), the time taken, and what confused them, in their own words.

## Tasks

| # | Task (read aloud) | Done when |
| --- | --- | --- |
| 1 | "Open the app and sign in. If you can, put it on your home screen." | Home shows "আসসালামু আলাইকুম, …" and today's status. |
| 2 | "You have arrived at the office. Record your attendance." (First time: register the phone, then HR approves it.) | "Punched at hh:mm" appears. |
| 3 | "How many days of casual leave do you have left?" | Says the right number from the Leave screen. |
| 4 | "Apply for one day of casual leave next week. The reason is a family programme." | The request shows "Waiting" in "My requests". |
| 5 | "You changed your plan. Cancel that leave request." | The request shows "Cancelled". |
| 6 | (Manager only) "Someone in your team asked for leave. Decide on it." | The request is gone from the Approvals inbox. |
| 7 | "Find last month's payslip. How much was your net pay? Save it as a PDF." | Says the right net pay, and the PDF opens. |
| 8 | "Your emergency contact number changed. Update it." | "Saved." appears. |
| 9 | "Switch the app to English, then back to Bangla." | The language changes immediately. |

## Pass mark

WP9 is accepted when both of these hold:

- **≥ 80 %** of all tasks across all participants are **done** or **done with difficulty**.
- **No task** is "not done" by more than one participant.

Every confusion noted becomes an item for the next release, even when the task passed.

## Automated rehearsal

The same tasks run as a script on a phone-sized browser against the demo data. Run it before
each pilot session:

```
cd Frontend/web
npm run e2e
```

It needs the API and the app running; see `Frontend/web/README.md`.

## Result sheet

| Participant (role, phone) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | |
