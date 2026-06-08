---
description: Post recent top stories from Hacker News on Bluesky.
---

# Workflow

1. **Fetch top stories** — Retrieve the top 3 stories from Hacker News
2. **Filter unposted** — Identify stories not yet posted to Bluesky in the last 10 posts
3. **Check** - if all top 3 stories have been posted, pick the next 3 stories and repeat step 2 
   until we find at least one unposted story
3. **Compose post** — Write a concise, Twitter-style post about the selected story. 
   - Include "#HN" and other relevant hashtags. no more than 3
   - Use emojis to make the post more engaging and visually appealing.
   - Use unicode characters to emulate bold and emphasize important parts.
   - Include the raw story URL on its own line without any prefixes (e.g. no "Read more:").
   - Format the post using multiline string with actual new line characters (avoid explicit "\n" in CLI commands).
4. **Review** - Show it to the user and ask for validation or modification
5. **Publish** — Post the content to Bluesky
6. **Report** - Provide an http link to the Bluesky post

Summarize the process, and start!