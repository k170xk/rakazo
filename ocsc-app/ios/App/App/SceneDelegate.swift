import UIKit
import AuthenticationServices
import Capacitor
import QuickLook
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
    private var pageHostObserver: NSKeyValueObservation?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SystemSignInPlugin())
        bridge?.registerPluginInstance(NativeFilesPlugin())
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
        pageHostObserver = webView?.observe(\.url, options: [.initial, .new]) { webView, _ in
            webView.scrollView.contentInsetAdjustmentBehavior =
                webView.url?.host == appHost ? .never : .automatic
        }

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

/// Downloads open in Quick Look instead of replacing the chat: Done returns to the chat and the
/// share button saves the file to Files or sends it on. Types Quick Look cannot show go straight
/// to the share sheet. `url` is fetched here (single-use download links); `base64` is a file the
/// page already holds.
@objc(NativeFilesPlugin)
class NativeFilesPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource {
    let identifier = "NativeFilesPlugin"
    let jsName = "NativeFiles"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]
    private var shown: URL?
    private var spinner: UIActivityIndicatorView?

    @objc func open(_ call: CAPPluginCall) {
        if let data = call.getString("base64").flatMap({ Data(base64Encoded: $0) }) {
            do {
                present(try store(data, named: call.getString("name")), call)
            } catch {
                call.reject("Could not save the file")
            }
            return
        }
        guard let url = call.getString("url").flatMap(URL.init(string:)), url.scheme == "https" else {
            call.reject("Missing file")
            return
        }
        DispatchQueue.main.async { self.showSpinner(true) }
        URLSession.shared.downloadTask(with: url) { [weak self] location, response, error in
            guard let self else { return }
            DispatchQueue.main.async { self.showSpinner(false) }
            guard let location, error == nil,
                  ((response as? HTTPURLResponse)?.statusCode ?? 500) < 400 else {
                call.reject("Could not download the file")
                return
            }
            do {
                let data = try Data(contentsOf: location)
                self.present(try self.store(data, named: call.getString("name") ?? response?.suggestedFilename), call)
            } catch {
                call.reject("Could not save the file")
            }
        }.resume()
    }

    private func store(_ data: Data, named name: String?) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let cleaned = (name ?? "")
            .components(separatedBy: CharacterSet(charactersIn: "/\\:\0")).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let file = folder.appendingPathComponent(String((cleaned.isEmpty ? "download" : cleaned).prefix(120)))
        try data.write(to: file)
        return file
    }

    private func present(_ file: URL, _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("No window")
                return
            }
            if QLPreviewController.canPreview(file as NSURL) {
                self.shown = file
                let preview = QLPreviewController()
                preview.dataSource = self
                host.present(preview, animated: true)
            } else {
                let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                share.popoverPresentationController?.sourceView = host.view
                share.popoverPresentationController?.sourceRect = CGRect(
                    x: host.view.bounds.midX, y: host.view.bounds.midY, width: 0, height: 0)
                host.present(share, animated: true)
            }
            call.resolve()
        }
    }

    private func showSpinner(_ on: Bool) {
        guard let view = bridge?.viewController?.view else { return }
        spinner?.removeFromSuperview()
        spinner = nil
        guard on else { return }
        let spinner = UIActivityIndicatorView(style: .large)
        spinner.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        spinner.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin]
        spinner.startAnimating()
        view.addSubview(spinner)
        self.spinner = spinner
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        shown == nil ? 0 : 1
    }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (shown ?? URL(fileURLWithPath: "/")) as NSURL
    }
}
