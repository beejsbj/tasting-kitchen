# browsers-40s - "How browsers work" in 40 s (30 fps, 120 BPM; every event on a 0.25 s grid)
World: 7 scene boards on a snake grid (16:9: 4 cols x 2 rows; 9:16: 2 cols x 4 rows). The camera flies between boards
(zoom-out arc + pan, 1.5 s centred on each cut) while a packet travels the wire joining them. Ending: pull back to the whole journey.
| # | time | board | events (s) |
|---|------|-------|------------|
| 1 | 0-6 | Title + address bar, URL anatomy | type 0.75-2.25, Enter 2.5, scheme/host/path 3.0/3.5/4.0, caption 4.5 |
| 2 | 6-12 | 1. Find the server | DNS query 6.75, answer 7.75, IP 8.5, SYN 8.75, SYN-ACK 9.25, ACK 9.75, TLS 10.0/10.5, GET 11.0, server glow 11.5 |
| 3 | 12-17 | 2. The server responds | headers 12.5/13.0/13.5, code lines 14.0+0.25i, bytes bar 14.0-16.25 |
| 4 | 17-23 | 3. Parse HTML -> DOM | token flight + node pop 17.5+0.5i (7 nodes), sweep 21.0, caption 21.5 |
| 5 | 23-28.5 | 4. CSS -> CSSOM -> Render tree | rules 23.5/24.0/24.5, merge 25.25, render nodes 26.0/26.5/27.0, strikes 26.25/27.25 |
| 6 | 28.5-33.5 | 5. Layout | frame 28.75, boxes 29.0/29.5/30.0, measure 30.5, resize 31-32 (reflow), back 32.5-33 |
| 7 | 33.5-40 | 6. Paint -> Composite | records 34.0-35.5, layers split 36.0, merge 37.0, pixel grid 37.5, pull-back 38.0-39.6, tagline 38.25 |
Score: A minor pad (Am-F-C-G per bar), bass from 6 s, kick from 12 s, hats from 17 s, whoosh on each camera flight, pluck on every visible event, bloom at 38, audio fade 38.8-40. Picture stays live to 40.0.
