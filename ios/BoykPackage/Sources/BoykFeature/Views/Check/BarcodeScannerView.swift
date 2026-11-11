@preconcurrency import AVFoundation
import SwiftUI

struct BarcodeScannerView: UIViewControllerRepresentable {
    let onBarcodeScanned: (String) -> Void
    let onDismiss: () -> Void
    // Called when the camera can't start (no camera, permission denied) so the
    // host can explain instead of the sheet silently vanishing.
    var onError: ((String) -> Void)?

    func makeUIViewController(context: Context) -> BarcodeScannerViewController {
        let vc = BarcodeScannerViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: BarcodeScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onBarcodeScanned: onBarcodeScanned, onDismiss: onDismiss, onError: onError)
    }

    class Coordinator: NSObject, BarcodeScannerDelegate {
        let onBarcodeScanned: (String) -> Void
        let onDismiss: () -> Void
        let onError: ((String) -> Void)?

        init(
            onBarcodeScanned: @escaping (String) -> Void,
            onDismiss: @escaping () -> Void,
            onError: ((String) -> Void)?
        ) {
            self.onBarcodeScanned = onBarcodeScanned
            self.onDismiss = onDismiss
            self.onError = onError
        }

        func didScanBarcode(_ code: String) {
            onBarcodeScanned(code)
        }

        func didFailWithError(_ error: String) {
            if let onError {
                onError(error)
            } else {
                onDismiss()
            }
        }
    }
}

protocol BarcodeScannerDelegate: AnyObject {
    func didScanBarcode(_ code: String)
    func didFailWithError(_ error: String)
}

class BarcodeScannerViewController: UIViewController, @preconcurrency AVCaptureMetadataOutputObjectsDelegate {
    weak var delegate: BarcodeScannerDelegate?

    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasScanned = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupCamera()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startSession()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopSession()
    }

    private func startSession() {
        guard let session = captureSession, !session.isRunning else { return }
        let sessionToStart = session
        DispatchQueue.global(qos: .userInitiated).async {
            sessionToStart.startRunning()
        }
    }

    private func stopSession() {
        guard let session = captureSession, session.isRunning else { return }
        let sessionToStop = session
        DispatchQueue.global(qos: .userInitiated).async {
            sessionToStop.stopRunning()
        }
    }

    private func setupCamera() {
        let session = AVCaptureSession()
        captureSession = session

        guard let device = AVCaptureDevice.default(for: .video) else {
            delegate?.didFailWithError("No camera available")
            return
        }

        guard let input = try? AVCaptureDeviceInput(device: device) else {
            delegate?.didFailWithError("Could not access camera")
            return
        }

        if session.canAddInput(input) {
            session.addInput(input)
        }

        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)

            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [
                .ean8, .ean13, .upce,
                .code128, .code39, .code93,
                .interleaved2of5, .itf14,
            ]
        }

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        previewLayer = preview

        let sessionToStart = session
        DispatchQueue.global(qos: .userInitiated).async {
            sessionToStart.startRunning()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasScanned,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let code = object.stringValue
        else { return }

        hasScanned = true
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        delegate?.didScanBarcode(code)
    }
}
