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
- **Reference materials:** Draw on bundled game reference snapshots.
- **Multilingual support:** Access the interface and guidance in different languages.

**[Open GameCoach](https://raineymisty.github.io/GameCoach/)**

The static website supports demo use. For real API conversations, start the Python backend or use your deployed HTTPS site. Local database Default / Import selects user data; the separate API connection form accepts the supported provider and Key. See [setup and secure team deployment](./DEPLOYMENT.md).

See [CHANGELOG.md](./CHANGELOG.md) for the current changes, suggested commit messages, actual Git history, and a detailed project tree marking browser and server responsibilities. The deployment guide also identifies the remaining work for a GitHub Pages frontend with a remote API.

## Architecture and Privacy

GameCoach is built with **HTML, CSS, and JavaScript** and supports static use plus an optional **FastAPI + SQLite** local backend. The frontend handles interaction and local data; **Skill** prepares team compositions, memories and game references; **AI Core** handles model requests. One backend chat API supports Gemini, DeepSeek, OpenAI (ChatGPT API), xAI (Grok) and Anthropic (Claude). It validates sessions, loads SQLite history, calls the selected provider, saves the profile and completed exchange, then returns a normalized answer. Switching providers preserves the conversation. See [backend setup and API](./back-end/README.md).

```text
Browser → same-origin Python API → model provider
                     ↓
           encrypted SQLite user history + training memory
```

**GameCoach does not capture your screen, read the game client, or automatically collect live match data.** Team compositions and match details are provided by you. Bundled game references are local snapshots of publicly available game information.

User profiles, history and training memory are shared across providers for the same server user. The browser keeps a local cache and can import/export user JSON. Completed existing chats can be imported into SQLite. Training memory is retrieved by the backend, not model fine-tuning.

The browser sends credentials only to your backend over HTTPS (loopback HTTP is allowed for local development). Provider requests and DNS happen on the server. User Keys and sensitive data fields are encrypted at rest, never returned by the API, and excluded from ordinary user exports. A separate private recovery file restores the server identity; protect it like an account credential. Team deployments use a private runtime config and an access code; the shareable source package excludes Keys and user data. See [DEPLOYMENT.md](./DEPLOYMENT.md) for steps and limits, including why a relay does not guarantee a campus network cannot observe or block your site.
