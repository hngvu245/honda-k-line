package com.kailc.hondakline;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_BT_PERMS = 1001;

    private WebView webView;
    private BtBridge btBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        Window win = getWindow();
        win.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        win.setStatusBarColor(Color.parseColor("#090A0D"));
        win.setNavigationBarColor(Color.parseColor("#090A0D"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090A0D"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        btBridge = new BtBridge(this, webView);
        webView.addJavascriptInterface(btBridge, "AndroidBT");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "appassets.local".equalsIgnoreCase(uri.getHost())) {
                    String path = uri.getPath();
                    if (path == null || path.equals("/")) {
                        path = "/www/index.html";
                    }
                    String assetPath = path.startsWith("/") ? path.substring(1) : path;
                    try {
                        InputStream stream = getAssets().open(assetPath);
                        String lower = assetPath.toLowerCase(Locale.US);
                        String mime = "application/octet-stream";
                        String encoding = "UTF-8";
                        if (lower.endsWith(".html")) {
                            mime = "text/html";
                        } else if (lower.endsWith(".css")) {
                            mime = "text/css";
                        } else if (lower.endsWith(".js")) {
                            mime = "application/javascript";
                        } else if (lower.endsWith(".woff2")) {
                            mime = "font/woff2";
                            encoding = null;
                        } else if (lower.endsWith(".json")) {
                            mime = "application/json";
                        } else if (lower.endsWith(".svg")) {
                            mime = "image/svg+xml";
                        } else if (lower.endsWith(".png")) {
                            mime = "image/png";
                            encoding = null;
                        }
                        return new WebResourceResponse(mime, encoding, stream);
                    } catch (IOException ignored) {
                        return null;
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        });

        setContentView(webView);
        applyImmersiveIfLandscape();
        webView.loadUrl("https://appassets.local/www/index.html");

        handleUsbIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleUsbIntent(intent);
    }

    private void handleUsbIntent(android.content.Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (android.hardware.usb.UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
            android.hardware.usb.UsbDevice device = (Build.VERSION.SDK_INT >= 33)
                ? intent.getParcelableExtra(android.hardware.usb.UsbManager.EXTRA_DEVICE, android.hardware.usb.UsbDevice.class)
                : intent.getParcelableExtra(android.hardware.usb.UsbManager.EXTRA_DEVICE);
            webView.postDelayed(() -> {
                if (btBridge != null) {
                    if (device != null) {
                        btBridge.connectUsbDevice(device);
                    } else {
                        btBridge.connectUsb();
                    }
                }
            }, 500);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveIfLandscape();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyImmersiveIfLandscape();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveIfLandscape();
        }
    }

    @SuppressWarnings("deprecation")
    private void applyImmersiveIfLandscape() {
        boolean isLandscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        Window win = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            win.setDecorFitsSystemWindows(!isLandscape);
            WindowInsetsController ic = win.getInsetsController();
            if (ic != null) {
                if (isLandscape) {
                    ic.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    ic.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    ic.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                }
            }
        } else {
            View decor = win.getDecorView();
            if (isLandscape) {
                decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                );
            } else {
                decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            }
        }
    }

    public boolean hasBtPermissions() {
        if (Build.VERSION.SDK_INT >= 31) {
            return checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    public void requestBtPermissions() {
        List<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN);
            }
        } else {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
        }
        if (needed.isEmpty()) {
            notifyPermResult(true);
        } else {
            requestPermissions(needed.toArray(new String[0]), REQ_BT_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_BT_PERMS) {
            boolean allGranted = grantResults.length > 0;
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            notifyPermResult(allGranted);
        }
    }

    private void notifyPermResult(boolean granted) {
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(
                "window.__onBtPermissions && window.__onBtPermissions(" + (granted ? "true" : "false") + ");",
                null
            ));
        }
    }

    @Override
    protected void onDestroy() {
        if (btBridge != null) {
            btBridge.shutdown();
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
