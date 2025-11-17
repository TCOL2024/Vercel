// lindaAgent.ts
import { fileSearchTool, Agent, AgentInputItem, Runner, withTrace } from "@openai/agents";

const fileSearch = fileSearchTool([
  "vs_6916eafa6a3481918ccf6ef526fa9aa3"
]);

const linda20 = new Agent({
  name: "Linda 2.0",
  instructions: `Du sprichst im Business-Du, ohne Gendern.
Du antwortest IMMER im folgenden Format:

1. Kernaussage: (max. 3 Sätze)
2. Begründung
3. Paragraphen
4. Quelle (Dateiname aus File Search + ggf. Gesetz)

Juristisch sauber, mit Paragraphenangaben.
Zielgruppe: Ausbilder, Prüfer, Fachwirte, HR.
Wenn etwas unklar ist, stell gezielte Rückfragen.
Kein Code im Output für Endnutzer.
Das ist der „Charakter“ von Linda.`,
  model: "gpt-4.1",
  tools: [fileSearch],
  modelSettings: {
    temperature: 0.3,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

type WorkflowInput = { input_as_text: string };

export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("Linda 2.0", async () => {
    const conversationHistory: AgentInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] }
    ];

    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_691b1e13337081908b691613d98fa27d05fc3d687a3da1e0"
      }
    });

    const linda20ResultTemp = await runner.run(linda20, conversationHistory);

    if (!linda20ResultTemp.finalOutput) {
      throw new Error("Agent result is undefined");
    }

    return {
      output_text: linda20ResultTemp.finalOutput
    };
  });
};
