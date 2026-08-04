# mcp-7timer

7Timer! MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `stargazing_forecast` | Astronomy observing forecast from 7Timer! ASTRO — the metrics stargazers and astrophotographers use to decide if tonight is good for observing: cloud cover, atmospheric seeing (steadiness), and sky transparency, at 3-hour resolution out to 72 hours. Each point gets a human-readable label and an observing_quality verdict, plus a best_window summary of the clearest/steadiest hours. Keyless. |
| `weather_forecast` | General weather forecast from 7Timer! CIVIL — temperature, humidity, a weather condition code (e.g. clearday, pcloudynight, lightrainday, tsday), cloud cover, wind, and precipitation type, at 3-hour resolution out to 72 hours. Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "7timer": {
      "url": "https://gateway.pipeworx.io/7timer/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about 7timer data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
