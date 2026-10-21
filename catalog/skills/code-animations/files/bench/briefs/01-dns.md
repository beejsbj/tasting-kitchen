# Bench brief 01: how DNS turns a name into an address

**Kind:** technical explainer.
**Duration: 25-35 s**
**Formats:** 16x9 and 9x16, one timeline.
**Audio:** procedural score only. No narration, no voice. On-screen text carries the words.
**Audience:** someone who types web addresses every day and has never wondered what happens next.

## Source facts (use these; no web research needed)

1. A user types `www.example.com`. The computer first checks its own cache (browser and operating system). Nothing there.
2. The computer asks a **recursive resolver** (usually run by the internet provider or a public service). The resolver does the rest of the work on the user's behalf.
3. The resolver asks a **root server**. There are 13 root server identities, named `a` to `m` (`a.root-servers.net` to `m.root-servers.net`), each run as many copies around the world. The root does not know the answer. It replies with a referral: "ask the `.com` servers".
4. The resolver asks a **`.com` TLD server**. It does not know the answer either. It replies with a referral to the **authoritative name servers** for `example.com`.
5. The resolver asks the **authoritative server** for `example.com`. This one knows. It returns an **A record**: `www.example.com -> 192.0.2.10` (a documentation address, RFC 5737), with a **TTL** of 3600 seconds.
6. The resolver hands the address to the computer and **caches** it for the TTL. The next lookup of the same name within the hour skips steps 3-5.
7. The browser now connects to `192.0.2.10`.

## What the film must show

- The four parties as distinct places: computer, resolver, root, `.com` TLD, authoritative server (five including the computer).
- The order of the questions exactly as above: two referrals, then the answer. The resolver is the one travelling; the computer only asks once.
- The address `192.0.2.10` on screen when it is returned. The TTL `3600 s` on screen when it is cached.
- A second, fast lookup at the end that is answered from the resolver cache, to show why caching matters.

## Deliverable

`works/bench-01/`: `STORYBOARD.md`, `index.html`, and the gates of the repo's Definition of done passing in 16x9 and 9x16.
