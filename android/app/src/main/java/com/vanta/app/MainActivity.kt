package com.vanta.app

import android.app.Activity
import android.app.Dialog
import android.Manifest
import android.content.pm.PackageManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.ClipData
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.google.firebase.messaging.FirebaseMessaging
import java.util.UUID

/**
 * Hosted VANTA WebView shell with a native, unified Camera / Photos / Files picker.
 *
 * The only JavaScript bridge is a nonce-gated native share-sheet action restricted
 * to the trusted VANTA origin. Existing HTML file inputs are routed through
 * WebChromeClient.onShowFileChooser, then selected content URIs return to the
 * original upload input. Authentication and uploads remain in VANTA.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val nativeShareNonce = UUID.randomUUID().toString()
    private val nativeGallery by lazy { NativeStatusGallery(this, VANTA_ORIGIN) }
    @Volatile private var galleryPageTrusted = false
    private var pendingFileCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null
    private var acceptedFileTypes: Array<String> = emptyArray()
    private var pendingGeolocationCallback: android.webkit.GeolocationPermissions.Callback? = null
    private var pendingGeolocationOrigin: String? = null
    // Overlapping getUserMedia calls (camera and mic) arrive as separate
    // PermissionRequests. They are queued and resolved together; none is denied
    // just because another arrived while the Android prompt was showing.
    private val pendingWebPermissions = mutableListOf<android.webkit.PermissionRequest>()
    private var webPermissionsAsked: Set<String> = emptySet()

    companion object {
        // Both APK variants use the same production origin from defaultConfig.
        private val VANTA_ORIGIN: String
            get() = BuildConfig.VANTA_ORIGIN
        private val VANTA_HOSTS = setOfNotNull(Uri.parse(BuildConfig.VANTA_ORIGIN).host)
        // Marker used only by the first-party Status media input to open the secure gallery.
        private const val STATUS_MEDIA_PICKER = "application/x-vanta-status-picker"
        private const val FILE_CHOOSER_REQUEST = 4107
        private const val CAMERA_REQUEST = 4108
        private const val CAMERA_URI_STATE = "vanta.pending.camera.uri"
        private const val LOCATION_PERMISSION_REQUEST = 4109
        private const val WEB_MEDIA_PERMISSION_REQUEST = 4110
        private const val STATUS_GALLERY_PERMISSION_REQUEST = 4112
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Android 15 enforces transparent system bars for edge-to-edge apps.
        // Keep the window/decor surface opaque so the status-bar region always
        // resolves to VANTA slate instead of exposing the dark window fallback.
        window.decorView.setBackgroundColor(Color.rgb(31, 38, 48))
        // Android 15+ enforces edge-to-edge for apps targeting API 35+.
        // Explicitly receive system-bar insets and apply them to the WebView
        // host so full-screen web routes (notably Reels) cannot occupy the
        // gesture or three-button navigation area.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        window.statusBarColor = Color.rgb(31, 38, 48)
        window.navigationBarColor = Color.rgb(31, 38, 48)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        CookieManager.getInstance().setAcceptCookie(true)

        pendingCameraUri = savedInstanceState?.getString(CAMERA_URI_STATE)?.let(Uri::parse)

        webView = createWebView()

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(31, 38, 48))
            addView(webView)
            setOnApplyWindowInsetsListener { view, insets ->
                val left: Int
                val top: Int
                val right: Int
                val bottom: Int
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars())
                    left = bars.left
                    top = bars.top
                    right = bars.right
                    bottom = bars.bottom
                } else {
                    @Suppress("DEPRECATION")
                    run {
                        left = insets.systemWindowInsetLeft
                        top = insets.systemWindowInsetTop
                        right = insets.systemWindowInsetRight
                        bottom = insets.systemWindowInsetBottom
                    }
                }
                // FrameLayout lays its MATCH_PARENT WebView inside this
                // padding, leaving the system navigation region native-owned.
                view.setPadding(left, top, right, bottom)
                insets
            }
        }
        setContentView(root)
        root.requestApplyInsets()

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        if (savedInstanceState == null) {
            // A notification may cold-start the activity. Honor its validated
            // internal route instead of always opening the homepage.
            val initialNotificationRoute = intent?.getStringExtra(
                VantaFirebaseMessagingService.EXTRA_NOTIFICATION_ROUTE
            )?.takeIf { it.startsWith("/") && !it.startsWith("//") }
            webView.loadUrl(VANTA_ORIGIN + (initialNotificationRoute ?: ""))
        } else {
            webView.restoreState(savedInstanceState) ?: webView.loadUrl(VANTA_ORIGIN)
        }

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4111)
        }
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            getSharedPreferences(VantaFirebaseMessagingService.PREFS, MODE_PRIVATE).edit()
                .putString(VantaFirebaseMessagingService.KEY_FCM_TOKEN, token).apply()
            publishNativeFcmToken(token)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val route = intent?.getStringExtra(VantaFirebaseMessagingService.EXTRA_NOTIFICATION_ROUTE)
        if (!route.isNullOrBlank() && route.startsWith("/") && !route.startsWith("//")) {
            webView.post { webView.loadUrl(VANTA_ORIGIN + route) }
        }
    }


    private fun createWebView(): WebView {
        return WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.rgb(5, 5, 5))

            settings.javaScriptEnabled = true
            addJavascriptInterface(VantaNativeShareBridge(), "VantaNative")
            addJavascriptInterface(VantaNativeGalleryBridge(), "VantaNativeGallery")
            addJavascriptInterface(VantaNativeVideoSaveBridge(), "VantaNativeVideo")
            settings.domStorageEnabled = true
            // Calls, livestreams, and camera previews attach MediaStreams after
            // the user's call / Go Live action. Do not require a second playback
            // gesture for remote audio or live video in the Android WebView.
            settings.mediaPlaybackRequiresUserGesture = false
            // The OS runtime permission and trusted-origin prompt remain required.
            settings.setGeolocationEnabled(true)
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.userAgentString = settings.userAgentString + " VANTAAndroid"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                settings.safeBrowsingEnabled = true
            }

            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    galleryPageTrusted = false
                    super.onPageStarted(view, url, favicon)
                }

                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    nativeGallery.intercept(request, galleryPageTrusted, hasStatusGalleryAccess())

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    if (!request.isForMainFrame) return false
                    val uri = request.url
                    if (uri.scheme == "https" && uri.host in VANTA_HOSTS) return false

                    if (uri.scheme == "https") {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    }
                    return true
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    galleryPageTrusted = isTrustedPage(url)
                    applySystemBottomInset()
                    publishNativeShareNonce(view, url)
                    publishNativeGalleryNonce(view, url)
                    publishNativeFcmToken()
                }

                override fun onReceivedSslError(
                    view: WebView,
                    handler: SslErrorHandler,
                    error: SslError
                ) {
                    handler.cancel()
                }

                override fun onRenderProcessGone(
                    view: WebView,
                    detail: android.webkit.RenderProcessGoneDetail
                ): Boolean {
                    val parent = view.parent as? ViewGroup ?: return false
                    val childIndex = parent.indexOfChild(view)
                    val layoutParams = view.layoutParams
                    val currentUrl = view.url?.takeIf(::isTrustedPage) ?: VANTA_ORIGIN

                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = null
                    pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
                    pendingGeolocationCallback = null
                    pendingGeolocationOrigin = null
                    denyAllPendingWebPermissions()

                    view.stopLoading()
                    view.webChromeClient = null
                    view.webViewClient = WebViewClient()
                    parent.removeView(view)
                    view.destroy()

                    webView = createWebView()
                    parent.addView(webView, childIndex, layoutParams)
                    webView.loadUrl(currentUrl)
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(
                    origin: String,
                    callback: android.webkit.GeolocationPermissions.Callback
                ) {
                    if (!isTrustedPage(origin)) {
                        callback.invoke(origin, false, false)
                        return
                    }
                    val fineGranted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    val coarseGranted = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    if (fineGranted || coarseGranted) {
                        callback.invoke(origin, true, false)
                        return
                    }
                    pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
                    pendingGeolocationCallback = callback
                    pendingGeolocationOrigin = origin
                    requestPermissions(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                        LOCATION_PERMISSION_REQUEST
                    )
                }

                override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                    // WebRTC capture is allowed only to the trusted VANTA origin.
                    if (!isTrustedPage(webView.url) || !isTrustedPage(request.origin.toString())) {
                        runOnUiThread { request.deny() }
                        return
                    }

                    val requested = request.resources.toSet()
                    val wantsVideo = requested.contains(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                    val wantsAudio = requested.contains(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                    if (!wantsVideo && !wantsAudio) {
                        runOnUiThread { request.deny() }
                        return
                    }

                    runOnUiThread {
                        pendingWebPermissions.add(request)
                        processPendingWebPermissions()
                    }
                }

                override fun onPermissionRequestCanceled(request: android.webkit.PermissionRequest) {
                    runOnUiThread { pendingWebPermissions.remove(request) }
                }

                override fun onShowFileChooser(
                    view: WebView,
                    filePathCallback: android.webkit.ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    if (!isTrustedPage(view.url)) {
                        filePathCallback.onReceiveValue(null)
                        return true
                    }

                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = filePathCallback
                    acceptedFileTypes = fileChooserParams.acceptTypes
                        .flatMap { it.split(",") }
                        .map { it.trim() }
                        .filter { it.contains("/") }
                        .distinct()
                        .toTypedArray()

                    val statusMediaPicker = STATUS_MEDIA_PICKER in acceptedFileTypes
                    acceptedFileTypes = acceptedFileTypes.filterNot { it == STATUS_MEDIA_PICKER }.toTypedArray()
                    val accepted = acceptedFileTypes
                    val mediaOnly = accepted.isNotEmpty() && accepted.all { it.startsWith("image/") || it.startsWith("video/") }
                    when {
                        statusMediaPicker -> launchPhotos(maxItems = 7)
                        mediaOnly && fileChooserParams.isCaptureEnabled -> launchCamera()
                        mediaOnly -> launchPhotos()
                        else -> launchFiles()
                    }
                    return true
                }
            }
        }
    }

    private fun publishNativeFcmToken(tokenOverride: String? = null) {
        if (!::webView.isInitialized || webView.url.isNullOrBlank() || !isTrustedPage(webView.url)) return
        val token = tokenOverride ?: getSharedPreferences(VantaFirebaseMessagingService.PREFS, MODE_PRIVATE)
            .getString(VantaFirebaseMessagingService.KEY_FCM_TOKEN, null)
        if (token.isNullOrBlank()) return
        val safeToken = org.json.JSONObject.quote(token)
        webView.post {
            webView.evaluateJavascript("window.__VANTA_NATIVE_FCM_TOKEN__ = " + safeToken + "; window.dispatchEvent(new CustomEvent('vanta-native-fcm-token', { detail: { token: " + safeToken + " } }));", null)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            LOCATION_PERMISSION_REQUEST -> {
                val granted = grantResults.indices.any { index ->
                    grantResults[index] == PackageManager.PERMISSION_GRANTED &&
                        (permissions[index] == Manifest.permission.ACCESS_FINE_LOCATION ||
                            permissions[index] == Manifest.permission.ACCESS_COARSE_LOCATION)
                }
                pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, granted, false)
                pendingGeolocationCallback = null
                pendingGeolocationOrigin = null
            }
            STATUS_GALLERY_PERMISSION_REQUEST -> {
                notifyNativeGalleryChanged()
            }
            WEB_MEDIA_PERMISSION_REQUEST -> {
                val asked = webPermissionsAsked
                webPermissionsAsked = emptySet()
                // Resolve every queued request whose needed permissions were part
                // of the prompt just answered; later arrivals needing a permission
                // that was not asked yet stay queued and trigger a new prompt.
                val iterator = pendingWebPermissions.iterator()
                while (iterator.hasNext()) {
                    val request = iterator.next()
                    val needed = androidPermissionsFor(request)
                    if (needed.all { it in asked || hasPermission(it) }) {
                        iterator.remove()
                        resolveWebPermission(request)
                    }
                }
                processPendingWebPermissions()
            }
        }
    }

    private fun hasPermission(permission: String) =
        checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun androidPermissionsFor(request: android.webkit.PermissionRequest): Set<String> {
        val out = mutableSetOf<String>()
        if (request.resources.contains(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)) out.add(Manifest.permission.CAMERA)
        if (request.resources.contains(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE)) out.add(Manifest.permission.RECORD_AUDIO)
        return out
    }

    /** Grants only the capture resources whose Android runtime permission is granted; trusted origin only. */
    private fun resolveWebPermission(request: android.webkit.PermissionRequest) {
        if (!isTrustedPage(webView.url) || !isTrustedPage(request.origin.toString())) {
            request.deny()
            return
        }
        val allowed = mutableListOf<String>()
        if (request.resources.contains(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE) && hasPermission(Manifest.permission.CAMERA)) {
            allowed.add(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        }
        if (request.resources.contains(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE) && hasPermission(Manifest.permission.RECORD_AUDIO)) {
            allowed.add(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE)
        }
        // A WebRTC capture request is valid only when all requested audio/video
        // resources have Android permission; avoid partial grants.
        if (allowed.isNotEmpty() && allowed.size == androidPermissionsFor(request).size) {
            request.grant(allowed.toTypedArray())
        } else {
            request.deny()
        }
    }

    private fun processPendingWebPermissions() {
        // Requests that already have everything they need resolve immediately.
        val iterator = pendingWebPermissions.iterator()
        while (iterator.hasNext()) {
            val request = iterator.next()
            if (androidPermissionsFor(request).all(::hasPermission)) {
                iterator.remove()
                resolveWebPermission(request)
            }
        }
        // Only one Android prompt at a time; the result handler re-runs this.
        if (webPermissionsAsked.isNotEmpty() || pendingWebPermissions.isEmpty()) return
        val missing = pendingWebPermissions
            .flatMap { androidPermissionsFor(it) }
            .filterNot(::hasPermission)
            .toSet()
        if (missing.isEmpty()) return
        webPermissionsAsked = missing
        requestPermissions(missing.toTypedArray(), WEB_MEDIA_PERMISSION_REQUEST)
    }

    private fun denyAllPendingWebPermissions() {
        pendingWebPermissions.toList().forEach { it.deny() }
        pendingWebPermissions.clear()
        webPermissionsAsked = emptySet()
    }

    private fun applySystemBottomInset() {
        if (!::webView.isInitialized) return
        webView.evaluateJavascript(
            // The WebView is already measured above the native navigation
            // bar, so adding the inset again in CSS would create a double gap.
            "document.documentElement.classList.add('vanta-native-android'); document.documentElement.style.setProperty('--vanta-native-safe-bottom', '0px'); document.documentElement.style.setProperty('--vanta-native-reel-action-offset', '64px')",
            null
        )
    }

    private fun publishNativeShareNonce(view: WebView, url: String?) {
        if (!isTrustedPage(url)) return
        view.evaluateJavascript("window.__VANTA_NATIVE_SHARE_NONCE = '$nativeShareNonce';", null)
    }

    private fun hasStatusGalleryAccess(): Boolean {
        return when {
            Build.VERSION.SDK_INT >= 34 ->
                hasPermission(Manifest.permission.READ_MEDIA_IMAGES) ||
                    hasPermission(Manifest.permission.READ_MEDIA_VIDEO) ||
                    hasPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            Build.VERSION.SDK_INT >= 33 ->
                hasPermission(Manifest.permission.READ_MEDIA_IMAGES) ||
                    hasPermission(Manifest.permission.READ_MEDIA_VIDEO)
            else -> hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    private fun requestStatusGalleryAccess() {
        if (!isTrustedPage(webView.url)) return
        if (hasStatusGalleryAccess()) {
            notifyNativeGalleryChanged()
            return
        }
        val required = when {
            Build.VERSION.SDK_INT >= 34 -> arrayOf(
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
            )
            Build.VERSION.SDK_INT >= 33 -> arrayOf(
                Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO
            )
            else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        requestPermissions(required, STATUS_GALLERY_PERMISSION_REQUEST)
    }

    private fun notifyNativeGalleryChanged() {
        if (!::webView.isInitialized || !isTrustedPage(webView.url)) return
        webView.evaluateJavascript(
            "window.dispatchEvent(new Event('vanta-native-gallery-changed'));", null
        )
    }

    private fun publishNativeGalleryNonce(view: WebView, url: String?) {
        if (!isTrustedPage(url)) return
        view.evaluateJavascript(
            "window.__VANTA_NATIVE_GALLERY_NONCE__ = '" + nativeGallery.nonce + "';" +
                "window.dispatchEvent(new Event('vanta-native-gallery-ready'));",
            null
        )
    }

    /**
     * Calls from iframes must not gain photo access. The nonce is delivered
     * exclusively to the trusted top-level VANTA page, not returned by the bridge.
     */
    inner class VantaNativeGalleryBridge {
        @JavascriptInterface
        fun listRecent(nonce: String?): String {
            if (nonce != nativeGallery.nonce || !galleryPageTrusted) {
                return """{"status":"unavailable","items":[]}"""
            }
            return nativeGallery.listRecent(hasStatusGalleryAccess())
        }

        @JavascriptInterface
        fun requestAccess(nonce: String?) {
            if (nonce != nativeGallery.nonce || !galleryPageTrusted) return
            runOnUiThread {
                if (isTrustedPage(webView.url)) requestStatusGalleryAccess()
            }
        }
    }

    inner class VantaNativeShareBridge {
        @JavascriptInterface
        fun shareText(text: String?, nonce: String?, requestId: String?) {
            if (nonce != nativeShareNonce || text.isNullOrBlank() || text.length > 4096) return
            if (requestId.isNullOrBlank() || !requestId.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return

            runOnUiThread {
                val opened = try {
                    if (!isTrustedPage(webView.url)) throw SecurityException("Untrusted VANTA page")
                    val sendIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, text.trim())
                    }
                    startActivity(Intent.createChooser(sendIntent, "Share with"))
                    true
                } catch (_: Exception) {
                    false
                }
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('vanta-native-share-result', { detail: { requestId: '$requestId', ok: $opened } }));",
                    null
                )
            }
        }
    }

    private val videoSaves = HashMap<String, java.io.OutputStream>()

    inner class VantaNativeVideoSaveBridge {
        /** Receives base64 chunks of an already-watermarked export and writes it to Movies/VANTA. */
        @JavascriptInterface
        fun saveVideoChunk(nonce: String?, id: String?, b64: String?, index: Int, total: Int, fileName: String?, mime: String?): Boolean {
            if (nonce != nativeShareNonce || b64 == null || total !in 1..2000 || index !in 0 until total) return false
            if (id.isNullOrBlank() || !id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return false
            val safeName = (fileName ?: "vanta.mp4").replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
            val type = if (mime == "video/webm") "video/webm" else "video/mp4"
            return try {
                var out = videoSaves[id]
                if (index == 0) {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, safeName)
                        put(android.provider.MediaStore.Video.Media.MIME_TYPE, type)
                        put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, "Movies/VANTA")
                    }
                    val uri = contentResolver.insert(android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: return false
                    out = contentResolver.openOutputStream(uri) ?: return false
                    videoSaves[id] = out
                }
                out ?: return false
                out.write(android.util.Base64.decode(b64, android.util.Base64.DEFAULT))
                if (index == total - 1) { out.close(); videoSaves.remove(id) }
                true
            } catch (_: Exception) {
                runCatching { videoSaves.remove(id)?.close() }
                false
            }
        }
    }

    private fun isTrustedPage(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val uri = Uri.parse(url)
        return uri.scheme == "https" && uri.host in VANTA_HOSTS
    }

    private fun showNativeAttachmentPicker() {
        val dialog = Dialog(this)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(22))
            background = roundedBackground(Color.rgb(17, 17, 19), 26)
        }

        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val titleBlock = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titleBlock.addView(TextView(this).apply {
            text = "Share a file"
            setTextColor(Color.WHITE)
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
        })
        titleBlock.addView(TextView(this).apply {
            text = "Choose how you want to attach it"
            setTextColor(Color.rgb(155, 155, 160))
            textSize = 12f
            setPadding(0, dp(4), 0, 0)
        })
        heading.addView(titleBlock, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        heading.addView(TextView(this).apply {
            text = "×"
            textSize = 27f
            setTextColor(Color.rgb(175, 175, 180))
            gravity = Gravity.CENTER
            setPadding(dp(10), 0, dp(4), dp(4))
            setOnClickListener { dialog.dismiss(); completeFileSelection(null) }
        })
        panel.addView(heading)

        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(18), dp(8), dp(4))
        }
        grid.addView(
            pickerTile("📷", "Camera", "Take a photo", Color.rgb(201, 162, 39)) {
                dialog.dismiss()
                launchCamera()
            },
            tileLayoutParams()
        )
        grid.addView(
            pickerTile("▧", "Photos", "Images & videos", Color.rgb(65, 177, 128)) {
                dialog.dismiss()
                launchPhotos()
            },
            tileLayoutParams()
        )
        grid.addView(
            pickerTile("📁", "Files", "Documents", Color.rgb(205, 205, 210)) {
                dialog.dismiss()
                launchFiles()
            },
            tileLayoutParams()
        )
        panel.addView(grid)
        dialog.setContentView(panel)
        dialog.setCancelable(true)
        dialog.setOnCancelListener { completeFileSelection(null) }
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setLayout(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setGravity(Gravity.BOTTOM)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setDimAmount(0.58f)
            attributes = attributes.apply {
                width = ViewGroup.LayoutParams.MATCH_PARENT
                height = ViewGroup.LayoutParams.WRAP_CONTENT
                gravity = Gravity.BOTTOM
                windowAnimations = android.R.style.Animation_InputMethod
            }
        }
        dialog.show()
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
    }

    private fun pickerTile(
        symbol: String,
        label: String,
        detail: String,
        accent: Int,
        onClick: () -> Unit
    ): View {
        // Telegram-style attachment option: bare circular icon with a label
        // underneath, no card behind it.
        val tile = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(6), dp(4), dp(6), dp(6))
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
        }
        val circle = FrameLayout(this).apply {
            val size = dp(56)
            layoutParams = LinearLayout.LayoutParams(size, size)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(38, Color.red(accent), Color.green(accent), Color.blue(accent)))
            }
            addView(TextView(this@MainActivity).apply {
                text = symbol
                textSize = 24f
                gravity = Gravity.CENTER
                setTextColor(accent)
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        tile.addView(circle)
        tile.addView(TextView(this).apply {
            text = label
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(7), 0, 0)
        })
        return tile
    }

    private fun tileLayoutParams() = LinearLayout.LayoutParams(
        0,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        1f
    ).apply {
        marginStart = dp(4)
        marginEnd = dp(4)
    }

    private fun roundedBackground(color: Int, radiusDp: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun launchCamera() {
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        if (intent.resolveActivity(packageManager) == null) {
            completeFileSelection(null)
            return
        }

        pendingCameraUri = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "vanta_capture_${System.currentTimeMillis()}.jpg")
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(
                    MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/VANTA"
                )
            }
            pendingCameraUri = contentResolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                values
            )
            pendingCameraUri?.let { uri ->
                intent.putExtra(MediaStore.EXTRA_OUTPUT, uri)
                intent.clipData = ClipData.newRawUri("VANTA camera output", uri)
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                // Camera apps often run in a separate package and require an
                // explicit URI grant to write the full-resolution capture.
                intent.resolveActivity(packageManager)?.let { resolved ->
                    grantUriPermission(
                        resolved.packageName,
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    )
                }
            }
        } else {
            // On older Android versions, request a full capture result rather
            // than allowing a picker-style fallback to satisfy the intent.
            intent.putExtra("return-data", true)
        }
        launchIntent(intent, CAMERA_REQUEST)
    }

    private fun launchPhotos(maxItems: Int = 10) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                type = "*/*"
                putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, maxItems)
            }
        } else {
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        }
        launchIntent(intent, FILE_CHOOSER_REQUEST)
    }

    private fun launchFiles() {
        val documentTypes = acceptedFileTypes.filterNot {
            it.startsWith("image/") || it.startsWith("video/")
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (documentTypes.size == 1) documentTypes[0] else "*/*"
            if (documentTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, documentTypes.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        launchIntent(intent, FILE_CHOOSER_REQUEST)
    }

    private fun launchIntent(intent: Intent, requestCode: Int) {
        try {
            startActivityForResult(intent, requestCode)
        } catch (_: ActivityNotFoundException) {
            pendingCameraUri?.let { runCatching { contentResolver.delete(it, null, null) } }
            pendingCameraUri = null
            completeFileSelection(null)
        } catch (_: SecurityException) {
            pendingCameraUri?.let { runCatching { contentResolver.delete(it, null, null) } }
            pendingCameraUri = null
            completeFileSelection(null)
        }
    }

    private fun completeFileSelection(uris: Array<Uri>?) {
        val callback = pendingFileCallback
        pendingFileCallback = null
        callback?.onReceiveValue(uris)
    }

    @Deprecated("Deprecated by Android; retained for broad device compatibility.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == CAMERA_REQUEST) {
            val cameraUri = pendingCameraUri
            pendingCameraUri = null
            if (resultCode == RESULT_OK) {
                val selected = cameraUri ?: data?.data
                if (selected != null) completeFileSelection(arrayOf(selected))
                else completeFileSelection(null)
            } else {
                cameraUri?.let { runCatching { contentResolver.delete(it, null, null) } }
                completeFileSelection(null)
            }
            return
        }

        if (requestCode != FILE_CHOOSER_REQUEST) return
        if (resultCode != RESULT_OK || data == null) {
            completeFileSelection(null)
            return
        }

        val selected = mutableListOf<Uri>()
        val clipData = data.clipData
        if (clipData != null) {
            for (index in 0 until clipData.itemCount) {
                clipData.getItemAt(index).uri?.let(selected::add)
            }
        } else {
            data.data?.let(selected::add)
        }
        completeFileSelection(selected.distinct().takeIf { it.isNotEmpty() }?.toTypedArray())
    }

    override fun onSaveInstanceState(outState: Bundle) {
        pendingCameraUri?.let { outState.putString(CAMERA_URI_STATE, it.toString()) }
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated by Android; retained for compatibility.")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = null
        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
        pendingGeolocationCallback = null
        denyAllPendingWebPermissions()
        if (isFinishing) {
            pendingCameraUri?.let { runCatching { contentResolver.delete(it, null, null) } }
            pendingCameraUri = null
        }
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            webView.destroy()
        }
        super.onDestroy()
    }
}
