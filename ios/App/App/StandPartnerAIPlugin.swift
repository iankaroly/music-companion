import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

// The door from the page to the language model built into the phone.
//
// It does one thing: take a prompt the page has already assembled out of
// measured facts, and return the model's words. It is given no tools and no
// access to recordings, so there is nothing for it to look up or to get wrong
// about the player's playing — every number in the prompt was computed by the
// page, and the page checks the reply against those numbers before showing it.
//
// The app's deployment target is older than the framework, so everything that
// touches FoundationModels is behind both a compile-time and a runtime check.
// On a phone that cannot run it `availability` says so with a reason, and the
// page shows the measurements as they are.
@objc(StandPartnerAIPlugin)
public class StandPartnerAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StandPartnerAIPlugin"
    public let jsName = "StandPartnerAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "respond", returnType: CAPPluginReturnPromise),
    ]

    @objc func availability(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true])
            case .unavailable(let reason):
                call.resolve(["available": false, "reason": Self.words(for: reason)])
            @unknown default:
                call.resolve(["available": false, "reason": "The on-device model is not available."])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": "This needs iOS 26 or later."])
    }

    @objc func respond(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("No prompt was given.")
            return
        }
        let instructions = call.getString("instructions") ?? ""
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    guard case .available = SystemLanguageModel.default.availability else {
                        call.reject("The on-device model is not available.", "unavailable")
                        return
                    }
                    // The window is 4096 tokens for prompt and reply together
                    // (measured on a Mac with the same framework: a prompt of
                    // about 4200 tokens comes back as exceededContextWindowSize
                    // in under a second). The page already keeps prompts well
                    // under it (MAX_PROMPT_CHARS in assistant.js); this is the
                    // second line, exact where the OS can count tokens.
                    if #available(iOS 26.4, *) {
                        let model = SystemLanguageModel.default
                        let used = try await model.tokenCount(for: instructions + "\n" + prompt)
                        if used + Self.maxReplyTokens > model.contextSize {
                            call.reject(Self.tooLong, "exceededContextWindowSize")
                            return
                        }
                    }
                    // A fresh session every time: a question about one take
                    // must not be coloured by the last question about another.
                    let session = LanguageModelSession(instructions: instructions)
                    // Temperature 0 because this is putting numbers into
                    // sentences, not writing; there is nothing to vary. The
                    // cap is because one real question ("which bars should I
                    // work on", asked of a take with no score) made the model
                    // count bars upward for 49 seconds until the window was
                    // full. A real answer is under a hundred tokens.
                    let options = GenerationOptions(temperature: 0.0, maximumResponseTokens: Self.maxReplyTokens)
                    let response = try await session.respond(to: prompt, options: options)
                    call.resolve(["text": response.content])
                } catch let error as LanguageModelSession.GenerationError {
                    call.reject(Self.words(for: error), Self.code(for: error))
                } catch {
                    call.reject("The model could not answer: \(error.localizedDescription)", "other")
                }
            }
            return
        }
        #endif
        call.reject("This needs iOS 26 or later.")
    }

    #if canImport(FoundationModels)
    private static let maxReplyTokens = 200
    private static let tooLong = "There was too much to read to the on-device model at once."

    // What the page shows as the note under a plain-measurements answer, so each
    // is a sentence a player can read. The code is for the page and for logs.
    @available(iOS 26.0, *)
    private static func words(for error: LanguageModelSession.GenerationError) -> String {
        switch error {
        case .exceededContextWindowSize:
            return tooLong
        case .guardrailViolation:
            // Seen on a harmless question ("how was the G Minor one"): the
            // model's own safety filter declined it. Nothing to retry.
            return "The on-device model declined to answer that."
        case .unsupportedLanguageOrLocale:
            return "The on-device model does not support this language."
        case .assetsUnavailable:
            return "The on-device model is not ready yet."
        case .rateLimited:
            return "The on-device model is busy; try again in a moment."
        case .concurrentRequests:
            return "The on-device model is already answering."
        case .refusal:
            return "The on-device model declined to answer that."
        default:
            return "The on-device model could not answer."
        }
    }

    @available(iOS 26.0, *)
    private static func code(for error: LanguageModelSession.GenerationError) -> String {
        switch error {
        case .exceededContextWindowSize: return "exceededContextWindowSize"
        case .guardrailViolation: return "guardrailViolation"
        case .unsupportedLanguageOrLocale: return "unsupportedLanguageOrLocale"
        case .assetsUnavailable: return "assetsUnavailable"
        case .rateLimited: return "rateLimited"
        case .concurrentRequests: return "concurrentRequests"
        case .refusal: return "refusal"
        default: return "other"
        }
    }

    @available(iOS 26.0, *)
    private static func words(for reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible:
            return "This device cannot run Apple Intelligence."
        case .appleIntelligenceNotEnabled:
            return "Apple Intelligence is turned off in Settings."
        case .modelNotReady:
            return "The on-device model is still downloading."
        @unknown default:
            return "The on-device model is not available."
        }
    }
    #endif
}
