import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Fixes the page at its width: iOS otherwise zooms in when a text box under 16px is tapped,
/// pushing the chat off the right edge.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        let script = WKUserScript(
            source: """
            (function () {
              var content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
              var meta = document.querySelector('meta[name="viewport"]');
              if (!meta) {
                meta = document.createElement("meta");
                meta.name = "viewport";
                document.head.appendChild(meta);
              }
              meta.setAttribute("content", content);
            })();
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        webView?.configuration.userContentController.addUserScript(script)

        // The keyboard shrinks the web view, uncovering the window behind its rounded corners;
        // paint the window the page's own colour so the two meet without a hard edge.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(matchWindowToPage),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
    }

    @objc private func matchWindowToPage() {
        guard let color = webView?.underPageBackgroundColor else { return }
        view.window?.backgroundColor = color
    }
}
