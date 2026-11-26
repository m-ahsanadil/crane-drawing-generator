# AI log

This file was drafted by Claude Code from the session transcript, the commit
history and my own work log, and then checked by me.

## Tools and what they were used for

| Tool | Used for |
|---|---|
| Claude Code (Claude Opus 5.5) in VS Code | Reading the brief, proposing the stack, writing the code and tests, running tests, rendering the drawing to screenshots for visual checks, and drafting README.md and this file |
| Claude.ai chat (a separate conversation) | Adversarial review passes on the finished code: attack, performance, security, validation and responsive. I pasted each report into Claude Code, which had to reproduce every finding before fixing it, with a test that failed first where possible |

DECISIONS.md: the answers are mine and were written without AI. Claude Code
only pasted them into the file, changed the numbers in the Q2 range table to
match the limits in the code, and added the table headers. It did not write or
reword the answers.

## Key prompts

I wrote my prompts in Roman Urdu; the English meaning is in brackets.

1. "follow ahsanadil.md. my assignment is take home assignment.pdf ab mjh
   smjhae mjhe krna kia hai aur yeh log kon hai aur mjhse kia chahte hain?"
   (Follow my standards file. Explain what I have to do, who these people are
   and what they want from me.) Produced a summary of the brief: the five
   minimum requirements, the deliverables and the grading order.
2. "tech stack knsa sahi h?" and then "ap btaen fastify ya express?" (Which
   stack is right? Fastify or Express?) Produced the stack proposal. Claude
   Code recommended Fastify for its request injection in tests and its central
   error handler, and I agreed.
3. "haan fix karo. ye maine ai ki glti pakri to ye log krega." (Yes, fix it. I
   caught the AI's mistake, so log it.) Sent with the first adversarial review
   report. Produced commit `6a953f6` (the name validation fix below) and the
   mistake log in my work notes.
4. "agr msla hai to code balde. mjhe har chez best chahiye" (If there is a real
   problem, change the code. I want everything done properly.) Sent with the
   performance report. Produced commit `0e8db46`: list paging moved from
   COUNT + OFFSET to a keyset cursor, measured at about 0.4 ms per page at
   100,000 designs instead of 10 to 25 ms.
5. "no reply karo .. phele yeh cheez q nh ayi?" (Use the noreply address. Why
   did you not raise this earlier?) The AI had committed with my personal
   e-mail without asking. The history was rewritten to the GitHub noreply
   address, with a backup first, and the code, messages and dates were checked
   to be unchanged.

## One time the AI was wrong, and how I caught it

The design name was only trimmed and length-checked. Control characters and
broken Unicode got through, and all 35 tests the AI had written were green,
because none of them tried such input.

- Effects, all reproduced: a name starting with NUL (`\u0000`) gave a 500 error,
  because SQLite's `length()` stops at NUL and the database CHECK failed after
  validation had passed. A NUL inside the name was saved, and the downloaded SVG
  became invalid XML. A lone surrogate (`\uD800`) was silently stored as `�`.
- How I caught it: I ran an adversarial review of commit `c6e6da8` in a separate
  Claude.ai chat, on a fresh clone, sending hostile requests to the running API.
- Fix: commit `6a953f6`. Names must be well-formed Unicode without control
  characters (400 otherwise), the SVG escaper drops XML-illegal characters, and
  each case has a test that failed before the fix.

## Other AI mistakes

I logged 37 AI mistakes in total. 25 were found by my review passes (run in
the separate Claude.ai chat) or by my own questions, 11 by Claude Code's own
checks (screenshots, logs, typecheck), and 1 by both. Some examples:

- Lifting height was first modelled as the hook height above the floor. A
  screenshot of a short-lift case drew a huge hoist, which showed the mistake;
  it is now the vertical hook travel below the highest hook position (commit
  `cb37996`). Found by the AI's own screenshot check.
- The API answered requests with any `Host` header, so a DNS-rebinding web page
  could read and change designs. Found in my security pass; fixed in `347571a`.
- "Open full size" opened the SVG as a same-origin page, so a script inside an
  SVG could have run in the app. Found in my security pass; fixed in `48979eb`.
- The AI wrote invisible Unicode characters raw into source files, including a
  direction-changing character inside a comment. Found by the AI when a test
  label failed; all tracked files were then scanned (`347571a`).
- A README draft said "I read the dimensions myself". That was not true: the AI
  read them off the reference drawing. Found by the AI on re-reading, and fixed
  before the first README commit.
- The default API port collided with another program on my machine (seen as
  `EADDRINUSE` in the log); it moved to 8787 (`b4eda8d`).
