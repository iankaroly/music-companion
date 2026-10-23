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
                        call.reject("The on-device model is not available.")
                        return
                    }
                    // A fresh session every time: a question about one take
                    // must not be coloured by the last question about another.
                    let session = LanguageModelSession(instructions: instructions)
                    // Temperature 0 because this is putting numbers into
                    // sentences, not writing; there is nothing to vary.
                    let options = GenerationOptions(temperature: 0.0)
                    let response = try await session.respond(to: prompt, options: options)
                    call.resolve(["text": response.content])
                } catch {
                    call.reject("The model could not answer: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("This needs iOS 26 or later.")
    }

    #if canImport(FoundationModels)
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
