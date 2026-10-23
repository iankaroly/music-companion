import UIKit
import Capacitor

// The rubber-band belongs to the web view's scroll view, not to the page.
// overscroll-behavior in CSS stops a scroll from chaining out of an element,
// but it cannot reach UIScrollView's bounce, which is why a tab whose content
// fitted the screen exactly could still be dragged up and down a little. That
// reads as the screen being loose rather than as scrolling.
//
// Tabs with more content than screen still scroll normally. They just stop at
// their ends instead of overshooting.
class MainViewController: CAPBridgeViewController {
    // A plugin that lives in the app target rather than in a package is not
    // found by Capacitor's package scan; it has to be handed to the bridge.
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StandPartnerAIPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.alwaysBounceHorizontal = false
    }
}
