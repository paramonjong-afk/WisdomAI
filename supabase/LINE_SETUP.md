# LINE work-summary setup

The integration stores new LINE group events after the bot webhook is enabled. LINE cannot automatically import earlier group-chat history.

## One-time setup

1. In LINE Developers, enable **Allow bot to join group chats**.
2. Copy the Supabase project reference from **Project Settings > General**.
3. Run from PowerShell at the project root:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-line-integration.ps1 -ProjectRef YOUR_PROJECT_REF
   ```

4. Enter the LINE Channel Secret and Channel Access Token when prompted. They are uploaded as Supabase secrets and are not stored in the repository.
5. Put the printed URL into **LINE Developers > Messaging API > Webhook URL**.
6. Enable **Use webhook** and **Webhook redelivery**, then verify the webhook.
7. Invite the bot into a LINE project group and send a new message.
8. Open **Work Summary** in WisdomAI. A manager can map the group to a project and review summaries.

## Group modes and project classification

- **Dedicated group:** choose one default project. Messages without a hashtag use that project.
- **Multi-project management group:** include one or more project codes, for example `#PJ001` or `#PJ001 #PJ002`.
- A reply inherits project assignments from the quoted message when no hashtag is present.
- If no project can be identified, the message appears in **รอจัดประเภท** for a manager to assign manually.
- The original LINE message is stored once; project links use a many-to-many mapping table.

## Gemini Free Tier analysis

1. Create a Gemini API key in Google AI Studio.
2. Do not paste the key into `.env`, Vite variables, source code, chat, or GitHub.
3. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-gemini-integration.ps1 -ProjectRef YOUR_PROJECT_REF
   ```

4. Enter the key when prompted. Input is hidden and the temporary secret file is deleted automatically.
5. Send a new text message in a connected LINE group.

The webhook uses `gemini-3.5-flash-lite` to produce a category, concise Thai summary,
assignee, urgency, confidence, and matching project codes. If the Gemini free quota
is exhausted or the service is unavailable, the original message is still saved and
the keyword classifier is used as a fallback. Server-only secrets stay in Supabase
Edge Function Secrets.
