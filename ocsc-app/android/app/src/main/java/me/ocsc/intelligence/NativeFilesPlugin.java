package me.ocsc.intelligence;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads are saved to Downloads and opened in the app that handles the type, instead of
 * replacing the chat. `url` is fetched here (single-use download links); `base64` is a file the
 * page already holds.
 */
@CapacitorPlugin(name = "NativeFiles")
public class NativeFilesPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String base64 = call.getString("base64");
        String url = call.getString("url");
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                InputStream input;
                String name = call.getString("name");
                String mimeType = call.getString("mimeType");
                if (base64 != null) {
                    input = new ByteArrayInputStream(Base64.decode(base64, Base64.DEFAULT));
                } else if (url != null && url.startsWith("https://")) {
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    if (connection.getResponseCode() >= 400) throw new IOException("status");
                    if (mimeType == null) mimeType = connection.getContentType();
                    if (name == null || name.isEmpty()) {
                        name = URLUtil.guessFileName(url, connection.getHeaderField("Content-Disposition"), mimeType);
                    }
                    input = connection.getInputStream();
                } else {
                    call.reject("Missing file");
                    return;
                }
                if (mimeType != null) mimeType = mimeType.split(";")[0].trim();
                if (mimeType == null || mimeType.isEmpty()) mimeType = guessType(name);
                Uri saved = save(input, clean(name), mimeType);
                show(saved, mimeType);
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not download the file");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    private Uri save(InputStream input, String name, String mimeType) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("insert");
            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IOException("open");
                copy(input, output);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri;
        }
        File folder = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (folder == null) throw new IOException("storage");
        File file = new File(folder, name);
        try (OutputStream output = new FileOutputStream(file)) {
            copy(input, output);
        }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    private void show(Uri uri, String mimeType) {
        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(view);
            } catch (ActivityNotFoundException ignored) {
                // No app opens this type; the file is still in Downloads.
            }
        });
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[65536];
        for (int read; (read = input.read(buffer)) != -1; ) output.write(buffer, 0, read);
        input.close();
    }

    private static String clean(String name) {
        String cleaned = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]+", "-").trim();
        if (cleaned.isEmpty()) cleaned = "download";
        return cleaned.length() > 120 ? cleaned.substring(0, 120) : cleaned;
    }

    private static String guessType(String name) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(name == null ? "" : name.replace(' ', '_'));
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
        return type == null ? "application/octet-stream" : type;
    }
}
