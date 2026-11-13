import UIKit
import AuthenticationServices
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

/// Fixes the app's page at its width: iOS otherwise zooms in when a text box under 16px is
/// tapped, pushing the chat off the right edge. Only the app's own site pads itself for the
/// status bar and home indicator, so other sites (sign-in pages) stay inside the safe area.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SystemSignInPlugin())
        let appHost = bridge?.config.serverURL.host ?? ""
        let script = WKUserScript(
            source: """
            (function () {
              if (location.host !== "\(appHost)") return;
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

/// Runs a sign-in page in the system sheet, which is Safari: paste, Passwords and the person's
/// Microsoft session work there, and Microsoft refuses some sign-ins inside embedded web views.
/// The sheet closes when it reaches `callbackPath` on the app's own host (an https callback,
/// which needs iOS 17.4 and the webcredentials associated domain), and hands that URL back.
@objc(SystemSignInPlugin)
class SystemSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    let identifier = "SystemSignInPlugin"
    let jsName = "SystemSignIn"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]
    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 17.4, *) else {
            call.unavailable("Needs iOS 17.4")
            return
        }
        guard let url = call.getString("url").flatMap(URL.init(string:)), url.scheme == "https",
              let host = bridge?.config.serverURL.host,
              let path = call.getString("callbackPath"), path.hasPrefix("/") else {
            call.reject("Missing sign-in address")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callback: .https(host: host, path: path)) { [weak self] result, error in
                self?.session = nil
                if let result {
                    call.resolve(["url": result.absoluteString])
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    call.resolve([:])
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed")
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Could not open sign-in")
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
