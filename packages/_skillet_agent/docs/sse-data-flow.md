# SSE Data Flow: Server to Browser Display

This document describes how SSE (Server-Sent Events) data flows from the API server through the network to the web frontend, and how each event type is rendered in the UI.

## 1. Shared Type Definitions

The shared contract lives in [sse_data_types.ts](../../_skillet_webclient/src/api_routes/sse_data_types.ts). `SseData` is a discriminated union of three variants:

| Variant | `type` field | Payload | Purpose |
|---|---|---|---|
| `SseDataChunk` | `'chunk'` | `AgentRunnerStepResult` | Incremental progress events |
| `SseDataDone` | `'done'` | `AgentRunnerFinalResult` + session metadata | Signals completion |
| `SseDataError` | `'error'` | `error: string` | Signals failure |

`AgentRunnerStepResult` (from [agent_runner_types.ts](../src/runner/agent_runner_types.ts)) is itself a union of 6 event types:

| Event | Key Fields |
|---|---|
| `agent_start` | `agentName` |
| `agent_end` | `agentName` |
| `agent_tool_start` | `agentName`, `toolName`, `toolArgumentsStr` |
| `agent_tool_end` | `agentName`, `toolName`, `result` |
| `handoff` | `agentName`, `toAgentName` |
| `text` | `text` |

## 2. Server Side — Producing SSE Events

The endpoint is `POST /api/session/newUserMessage/:id` in [api_sessions.ts](../../_skillet_webclient/src/api_routes/api_sessions.ts).

1. Sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`).
2. Defines a helper `sendSseData(data: SseData)` that serializes each event as `data: ${JSON.stringify(data)}\n\n`.
3. Calls `AgentRunner.runOneShotAsyncGenerator()` which returns an `AsyncGenerator<AgentRunnerStepResult, AgentRunnerFinalResult>`.
4. **Streaming loop**: iterates the generator. Each `yield`ed value is wrapped in `SseDataChunk` and sent via `sendSseData`.
5. When the generator returns (`.done === true`), the return value is wrapped in `SseDataDone` and sent.
6. On error, wraps the message in `SseDataError` and sends.
7. Finally calls `response.end()`.

The server also tracks client disconnect via `request.on('close')` to stop processing early if the client goes away.

## 3. Client Side — Consuming SSE Events

The client helper is [api_session_helper.ts](../../_skillet_webclient/public/_src/api_helpers/api_session_helper.ts), method `newUserMessageAsyncGenerator()`.

It mirrors the server's async generator pattern on the client:

1. POSTs to the endpoint using `fetch()`.
2. Reads the response body as a stream via `response.body.getReader()`.
3. A **background consumer** reads raw bytes, accumulates into a buffer, splits on `\n\n`, extracts `data: ` payloads, parses JSON as `SseData`, and pushes into an internal queue.
4. A **notify mechanism** wakes the generator loop when new data arrives in the queue.
5. The **generator loop** pops from the queue and dispatches by type:
   - `type === 'chunk'` — **yields** `SseDataChunk` to the caller
   - `type === 'done'` — **returns** `SseDataDone` (generator finishes)
   - `type === 'error'` — **throws** an Error

This gives the caller an `AsyncGenerator<SseDataChunk, SseDataDone>` — the same shape as the server-side generator but over the network.

## 4. UI Layer — Rendering SSE Data

The main app in [main.ts](../../_skillet_webclient/public/chat/src/main.ts), method `onSend()`, consumes the generator:

1. Calls `ApiSessionHelper.newUserMessageAsyncGenerator(message, attachments)`.
2. Creates a streaming message handle via `UiMessageHelper.beginAgentMessage()`. This returns an object with two methods: `appendChunk()` and `finish()`.
3. **Loops over chunks**: for each `SseDataChunk`, calls `appendChunk(sseDataChunk)`. If the step result type transitions from a non-text event to a `text` event, it finishes the current message bubble and starts a new one.
4. On completion, calls `finish(sseDataDone)`.

## 5. Rendering Logic per Event Type

The DOM rendering happens in [ui_message_helper.ts](../../_skillet_webclient/public/chat/src/libs/ui_message_helper.ts), method `_beginAgentMessageAppendChunk()`:

| Step Result Type | Visual Output |
|---|---|
| `handoff` | "**AgentA** handing off to **AgentB**..." inside the Thinking accordion |
| `agent_tool_start` | Tool name + arguments in a `<pre>` block inside the Thinking accordion. Special formatting for `run_command_line`: displays reason + command separately |
| `agent_tool_end` | Tool return value in a `<pre>` block inside the Thinking accordion |
| `text` | Accumulates text chunks, re-renders as **markdown** (via `marked`) into a `.markdown-message` div. Removes the Thinking spinner |

Non-text events (handoff, tool start/end) go inside a collapsible **"Thinking" accordion**, lazy-created on the first non-text chunk. Text events go into a separate **markdown message bubble**.

## 6. Flow Diagram

```
Server                          Network                    Client
------                          -------                    ------
AgentRunner.runOneShotAsync     SSE stream                 fetch + ReadableStream
  Generator                     data: {...}\n\n              |
  |                                                        api_session_helper.ts
  yield StepResult --> SseDataChunk --> parse JSON --> yield SseDataChunk
  yield StepResult --> SseDataChunk --> parse JSON --> yield SseDataChunk
  ...                                                        |
  return FinalResult > SseDataDone  --> parse JSON --> return SseDataDone
  (or catch) ---------> SseDataError --> parse JSON --> throw Error
                                                             |
                                                       main.ts onSend()
                                                             |
                                                       UiMessageHelper
                                                         |-- text         --> markdown bubble
                                                         |-- tool_start   --> "Thinking" accordion
                                                         |-- tool_end     --> "Thinking" accordion
                                                         '-- handoff      --> "Thinking" accordion
```

## 7. Key Design Insight

The architecture uses **symmetric async generators**: the server produces `AsyncGenerator<StepResult, FinalResult>`, the network transport uses SSE with three discriminated types (`chunk`, `done`, `error`), and the client reconstructs the same `AsyncGenerator<SseDataChunk, SseDataDone>` shape. This makes the streaming protocol nearly transparent to the UI code — it consumes the remote generator the same way it would consume a local one.
