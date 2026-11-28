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
    companion object {
        private const val GALLERY_PATH = "/__vanta_native_gallery/"
        fun isGalleryPath(path: String?): Boolean = path?.startsWith(GALLERY_PATH) == true
    }

    val nonce: String = UUID.randomUUID().toString()
    private val expectedHost = Uri.parse(origin).host
    private val entries = ConcurrentHashMap<String, MediaEntry>()
    private val prefix = GALLERY_PATH + nonce + "/"

    private data class MediaEntry(
        val key: String,
        val uri: Uri,
        val name: String,
        val mime: String,
        val size: Long
    )

    /**
     * Query Photos and Videos separately: scoped/selected-photo Android grants
     * may allow one collection but not the other. Files.getContentUri does not
     * reliably expose partial grants across all Android versions.
     */
    fun listRecent(allowed: Boolean): String {
        val result = JSONObject()
        val items = JSONArray()
        if (!allowed) {
            entries.clear()
            return result.put("status", "permission").put("items", items).toString()
        }

        val candidates = mutableListOf<Pair<Long, MediaEntry>>()
        var permissionFailures = 0
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_ADDED
        )

        for ((collection, video) in listOf(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI to false,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI to true
        )) {
            try {
                activity.contentResolver.query(
                    collection, projection, null, null,
                    MediaStore.MediaColumns.DATE_ADDED + " DESC"
                )?.use { cursor ->
                    val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                    val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                    val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                    val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                    val dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
                    var count = 0
                    while (cursor.moveToNext() && count < 120) {
                        val id = cursor.getLong(idCol)
                        val mime = cursor.getString(mimeCol) ?: if (video) "video/mp4" else "image/jpeg"
                        if (!(if (video) mime.startsWith("video/") else mime.startsWith("image/"))) continue
                        val key = (if (video) "v" else "i") + id
                        val uri = ContentUris.withAppendedId(collection, id)
                        val name = (cursor.getString(nameCol) ?: key).take(160)
                        val size = cursor.getLong(sizeCol).coerceAtLeast(0)
                        val dateAdded = cursor.getLong(dateCol)
                        candidates.add(dateAdded to MediaEntry(key, uri, name, mime, size))
                        count++
                    }
                }
            } catch (_: SecurityException) {
                permissionFailures++
            } catch (_: Exception) {
                // Keep items from the other collection, if one is readable.
            }
        }

        if (permissionFailures == 2) {
            entries.clear()
            return result.put("status", "permission").put("items", items).toString()
        }

        val current = candidates.sortedByDescending { it.first }.take(120).map { it.second }
        entries.clear()
        entries.putAll(current.associateBy { it.key })
        for (entry in current) {
            items.put(JSONObject()
                .put("id", entry.key).put("name", entry.name)
                .put("mimeType", entry.mime).put("size", entry.size)
                .put("thumbnailUrl", origin + prefix + "thumb/" + entry.key)
                .put("mediaUrl", origin + prefix + "full/" + entry.key)
            )
        }
        return result.put("status", "ready").put("items", items).toString()
    }

    /** Serve only previously enumerated MediaStore entries to the trusted WebView. */
    fun intercept(request: WebResourceRequest, trustedPage: Boolean, allowed: Boolean): WebResourceResponse? {
        val url = request.url
        val path = url.path ?: return null
        if (!isGalleryPath(path)) return null
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
                // Release decoded native pixel memory even if JPEG encoding fails.
                val bytes = ByteArrayOutputStream()
                val encoded = try {
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 77, bytes)
                } finally {
                    bitmap.recycle()
                }
                if (!encoded) return blocked()
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
