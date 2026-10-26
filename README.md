# GameCoach

<p align="center">
  <a href="https://raineymisty.github.io/GameCoach/">
    <strong>🎮 Play GameCoach Live →</strong>
  </a>
</p>

<p align="center">
  An AI game coach for players, viewers, and coaches.
</p>

GameCoach aims to help people with different levels of experience and goals find the guidance they need. They might be a beginner discovering a game, an experienced player looking to improve, a viewer who has never played but wants to understand a match, or a coach studying team compositions and tactics.

The AI program assists players learning the rules, understanding how to play, discussing in-game decisions and tactical choices in competitive matches. Users start with their own questions. Through conversation, follow-up questions, and additional context, GameCoach aims to offer explanations and suggestions suited to the their background and goals.

## Features and Usage

- **Team compositions and draft:** Edit both teams, adjust positions, and use different ban/pick formats.
- **Quick / Coach modes:** Get quick suggestions or explore a question in depth.
- **Personal memory:** Save and manage your background, preferences, and coaching needs.
- **Reference materials:** Draw on game information and search the web when needed.
- **Multilingual support:** Access the interface and guidance in different languages.

**[Open GameCoach](https://raineymisty.github.io/GameCoach/)**

Open the settings panel on the right, enter your own API key for a supported AI provider, choose a mode, and start a conversation.

## Architecture and Privacy

GameCoach is built with **HTML, CSS, and JavaScript** and currently runs as a static website with no application backend. The frontend handles interaction and local data; **Skill** prepares the relevant team compositions, conversation history, memories, and game references; **AI Core** handles model requests and streaming responses.

```text
Frontend → Skill → AI Core → Skill → Frontend
             ↑
      Memory + game references
```

**GameCoach does not capture your screen, read the game client, or automatically collect live match data.** Team compositions and match details are provided by you. Bundled game references are local snapshots of publicly available game information.

Profiles, chat history, and personal memories are stored locally in your browser. You can export backups or explicitly connect a local folder to save them. There are no cloud accounts or automatic uploads of your complete local user archive.

When you use an AI service, your question and the relevant context are sent directly from your browser to the configured provider. If web search is enabled, searches are handled through that provider. Your API key stays in the current page's memory, is excluded from saved user data and exports, and is cleared when you refresh or close the page.
