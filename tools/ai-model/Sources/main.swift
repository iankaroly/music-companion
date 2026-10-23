// Dev harness: runs prompts through the SAME FoundationModels the phone plugin
// uses and writes the replies to JSON. Not part of the app.
//
//   swiftc -parse-as-library -O tools/ai-model/Sources/main.swift -o /tmp/ai-model
//   /tmp/ai-model availability
//   /tmp/ai-model run cases.json replies.json [maxResponseTokens]
//
// maxResponseTokens defaults to the same cap the plugin uses. Without a cap one
// held-out question ("which bars should I work on", asked of a take with no
// score) ran the model for 49 s and ended in exceededContextWindowSize: the
// REPLY filled the window, not the prompt.
//
// It mirrors StandPartnerAIPlugin.respond on purpose: a fresh session per case,
// temperature 0, no tools. It adds timing and the typed error, which the plugin
// flattens into a string.
import Foundation
import FoundationModels

struct Case: Decodable { let id: Int; let instructions: String; let prompt: String }
struct Reply: Encodable { let id: Int; let text: String?; let error: String?; let ms: Double; let promptTokens: Int? }

func errorKind(_ e: Error) -> String {
    if let g = e as? LanguageModelSession.GenerationError {
        switch g {
        case .exceededContextWindowSize: return "exceededContextWindowSize"
        case .guardrailViolation: return "guardrailViolation"
        case .unsupportedLanguageOrLocale: return "unsupportedLanguageOrLocale"
        case .assetsUnavailable: return "assetsUnavailable"
        case .rateLimited: return "rateLimited"
        case .concurrentRequests: return "concurrentRequests"
        case .refusal: return "refusal"
        case .decodingFailure: return "decodingFailure"
        case .unsupportedGuide: return "unsupportedGuide"
        @unknown default: return "unknownGenerationError"
        }
    }
    return "other: \(e.localizedDescription)"
}

@main struct Harness {
    static func main() async throws {
        let args = CommandLine.arguments
        let model = SystemLanguageModel.default
        guard args.count > 1 else { print("usage: availability | run cases.json out.json"); return }
        if args[1] == "availability" {
            print("availability: \(model.availability)")
            if #available(macOS 26.4, *) { print("contextSize: \(model.contextSize)") }
            print("supportedLanguages: \(model.supportedLanguages.map { $0.minimalIdentifier }.sorted().prefix(12))")
            return
        }
        guard case .available = model.availability else {
            print("UNAVAILABLE: \(model.availability)"); exit(2)
        }
        let cap = args.count > 4 ? Int(args[4]) : 200
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
        var out: [Reply] = []
        for c in cases {
            let session = LanguageModelSession(instructions: c.instructions)
            var tokens: Int? = nil
            if #available(macOS 26.4, *) { tokens = try? await model.tokenCount(for: c.instructions + "\n" + c.prompt) }
            let t0 = Date()
            do {
                let r = try await session.respond(to: c.prompt, options: GenerationOptions(temperature: 0.0, maximumResponseTokens: cap))
                out.append(Reply(id: c.id, text: r.content, error: nil, ms: Date().timeIntervalSince(t0) * 1000, promptTokens: tokens))
            } catch {
                out.append(Reply(id: c.id, text: nil, error: errorKind(error), ms: Date().timeIntervalSince(t0) * 1000, promptTokens: tokens))
            }
            if out.count % 20 == 0 { FileHandle.standardError.write("\(out.count)/\(cases.count)\n".data(using: .utf8)!) }
        }
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted]
        try enc.encode(out).write(to: URL(fileURLWithPath: args[3]))
        print("wrote \(out.count) replies")
    }
}
