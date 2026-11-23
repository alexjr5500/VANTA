package com.vanta.app

import android.app.Activity
import android.content.ContentUris
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Permission-scoped Android MediaStore gallery for the first-party Status page.
 * The WebView only sees media that Android allows this app to read. URLs below
 * are intercepted locally and NEVER sent to VANTA servers before posting.
 */
internal class NativeStatusGallery(private val activity: Activity, private val origin: String) {
    val nonce: String = UUID.randomUUID().toString()
    private val expectedHost = Uri.parse(origin).host
    private val entries = ConcurrentHashMap<String, MediaEntry>()
    private val prefix = "/__vanta_native_gallery/" + nonce + "/"

    private data class MediaEntry(
        val key: String,
        val uri: Uri,
        val name: String,
        val mime: String,
        val size: Long
    )

    fun listRecent(allowed: Boolean): String {
        val result = JSONObject()
        val items = JSONArray()
        if (!allowed) return result.put("status", "permission").put("items", items).toString()
        try {
            val columns = arrayOf(
                MediaStore.Files.FileColumns._ID,
                MediaStore.Files.FileColumns.MEDIA_TYPE,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.MIME_TYPE,
                MediaStore.MediaColumns.SIZE
            )
            val selection = MediaStore.Files.FileColumns.MEDIA_TYPE + " IN (?, ?)"
            val args = arrayOf(
                MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
                MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString()
            )
            val current = HashMap<String, MediaEntry>()
            activity.contentResolver.query(
                MediaStore.Files.getContentUri("external"),
                columns,
                selection,
                args,
                MediaStore.MediaColumns.DATE_ADDED + " DESC"
            )?.use { cursor ->
                val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
                val typeColumn = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
                val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                while (cursor.moveToNext() && current.size < 120) {
                    val id = cursor.getLong(idColumn)
                    val video = cursor.getInt(typeColumn) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                    val mime = cursor.getString(mimeColumn) ?: if (video) "video/mp4" else "image/jpeg"
                    if (!mime.startsWith("image/") && !mime.startsWith("video/")) continue
                    val key = (if (video) "v" else "i") + id
                    val uri = ContentUris.withAppendedId(
                        if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id
                    )
                    val name = (cursor.getString(nameColumn) ?: key).take(160)
                    val size = cursor.getLong(sizeColumn).coerceAtLeast(0)
                    val entry = MediaEntry(key, uri, name, mime, size)
                    current[key] = entry
                    items.put(JSONObject()
                        .put("id", key).put("name", name).put("mimeType", mime).put("size", size)
                        .put("thumbnailUrl", origin + prefix + "thumb/" + key)
                        .put("mediaUrl", origin + prefix + "full/" + key)
                    )
                }
            }
            entries.clear()
            entries.putAll(current)
            result.put("status", "ready")
        } catch (_: SecurityException) {
            entries.clear()
            result.put("status", "permission")
        } catch (_: Exception) {
            result.put("status", "error")
        }
        return result.put("items", items).toString()
    }

    /** Serve only previously enumerated MediaStore entries to the trusted WebView. */
    fun intercept(request: WebResourceRequest, trustedPage: Boolean, allowed: Boolean): WebResourceResponse? {
        val url = request.url
        val path = url.path ?: return null
        if (!path.startsWith("/__vanta_native_gallery/")) return null
        if (request.isForMainFrame || request.method != "GET" ||
            url.scheme != "https" || url.host != expectedHost || !trustedPage || !allowed
        ) return blocked()

        if (!path.startsWith(prefix)) return blocked()
        val suffix = path.removePrefix(prefix).split("/")
        if (suffix.size != 2 || suffix[0] !in setOf("thumb", "full")) return blocked()
        val entry = entries[suffix[1]] ?: return blocked()
        return try {
            if (suffix[0] == "full") {
                val input = activity.contentResolver.openInputStream(entry.uri) ?: return blocked()
                response(entry.mime, input)
            } else {
                val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    activity.contentResolver.loadThumbnail(entry.uri, Size(256, 256), null)
                } else {
                    @Suppress("DEPRECATION")
                    if (entry.mime.startsWith("video/")) {
                        MediaStore.Video.Thumbnails.getThumbnail(
                            activity.contentResolver,
                            entry.uri.lastPathSegment?.toLongOrNull() ?: 0L,
                            MediaStore.Video.Thumbnails.MINI_KIND,
                            null
                        )
                    } else {
                        MediaStore.Images.Thumbnails.getThumbnail(
                            activity.contentResolver,
                            entry.uri.lastPathSegment?.toLongOrNull() ?: 0L,
                            MediaStore.Images.Thumbnails.MINI_KIND,
                            null
                        )
                    }
                } ?: return blocked()
                val bytes = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 77, bytes)
                bitmap.recycle()
                response("image/jpeg", ByteArrayInputStream(bytes.toByteArray()))
            }
        } catch (_: Exception) {
            blocked()
        }
    }

    private fun response(mime: String, input: java.io.InputStream): WebResourceResponse =
        WebResourceResponse(
            mime, null, 200, "OK",
            mapOf("Cache-Control" to "private, no-store", "X-Content-Type-Options" to "nosniff"),
            input
        )

    private fun blocked(): WebResourceResponse =
        WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(ByteArray(0)))
}
