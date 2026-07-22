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

## No-cost analysis

The current classifier uses Thai and English keywords for completed, in progress, planned, issue, risk, material, safety, and general. Images and files are stored securely but are not visually interpreted without an AI service.
