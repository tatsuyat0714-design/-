package com.chojigen.soccer;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// APK に同梱したゲーム（assets/index.html）を WebView で表示するだけのアクティビティ
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B1020"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // セーブデータ（localStorage）用
        s.setAllowFileAccess(true);
        s.setTextZoom(100); // 端末の文字サイズ設定でレイアウトが崩れないように
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient()); // confirm() ダイアログ用
        setContentView(web);
        if (savedInstanceState == null) web.loadUrl("file:///android_asset/index.html");
        else web.restoreState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    public void onBackPressed() {
        new AlertDialog.Builder(this)
                .setMessage("ゲームを終了しますか？\n（進行は自動でセーブされています）")
                .setPositiveButton("終了", (d, w) -> finish())
                .setNegativeButton("キャンセル", null)
                .show();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
