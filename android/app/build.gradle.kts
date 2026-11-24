import java.net.URI
import java.util.zip.ZipFile

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

val releaseKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
val releaseKeystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")

// The signed GitHub release workflow supplies a monotonically increasing run
// number. Local/CI debug builds retain the baseline instead of accidentally
// distributing production APKs with indistinguishable fixed versionCode=1.
val releaseVersionCode = providers.gradleProperty("vantaReleaseVersionCode")
    .orNull?.toIntOrNull()?.takeIf { it > 0 } ?: 1

// A debug APK may target this project's Vercel preview so unmerged UI fixes
// can be tested in the actual WebView. Release builds always use production.
// Set with -PvantaDebugOrigin=https://<preview>-vanta-73db.vercel.app
// or VANTA_DEBUG_ORIGIN. Do not trust arbitrary preview owners: the WebView
// exposes first-party Android bridges to its configured origin.
val vantaDebugOrigin = providers.gradleProperty("vantaDebugOrigin")
    .orElse(providers.environmentVariable("VANTA_DEBUG_ORIGIN"))
    .orNull
    ?.trim()
    ?.trimEnd('/')
    ?.takeIf { it.isNotEmpty() }

vantaDebugOrigin?.let { origin ->
    val url = URI(origin)
    require(
        url.scheme == "https" &&
        url.host?.endsWith("-vanta-73db.vercel.app") == true &&
        url.port == -1 &&
        url.rawPath.isNullOrEmpty() &&
        url.rawQuery == null &&
        url.rawFragment == null &&
        url.userInfo == null
    ) {
        "Android debug preview origin must be an HTTPS VANTA Vercel preview host (no path or query)"
    }
}

val vantaBrandingArchive = rootProject.file("../frontend/public/branding/vanta-original-logo-assets.zip")
val installVantaLauncherIcons by tasks.registering {
    inputs.file(vantaBrandingArchive)
    outputs.dir(layout.projectDirectory.dir("src/main/res/mipmap-mdpi"))
    outputs.dir(layout.projectDirectory.dir("src/main/res/mipmap-hdpi"))
    outputs.dir(layout.projectDirectory.dir("src/main/res/mipmap-xhdpi"))
    outputs.dir(layout.projectDirectory.dir("src/main/res/mipmap-xxhdpi"))
    outputs.dir(layout.projectDirectory.dir("src/main/res/mipmap-xxxhdpi"))

    doLast {
        check(vantaBrandingArchive.isFile) {
            "Original VANTA logo archive not found at ${vantaBrandingArchive.absolutePath}"
        }
        val iconEntries = mapOf(
            "android-mdpi-48.png" to "mipmap-mdpi/ic_launcher.png",
            "android-hdpi-72.png" to "mipmap-hdpi/ic_launcher.png",
            "android-xhdpi-96.png" to "mipmap-xhdpi/ic_launcher.png",
            "android-xxhdpi-144.png" to "mipmap-xxhdpi/ic_launcher.png",
            "android-xxxhdpi-192.png" to "mipmap-xxxhdpi/ic_launcher.png"
        )
        ZipFile(vantaBrandingArchive).use { archive ->
            iconEntries.forEach { (entryName, outputPath) ->
                val entry = archive.getEntry(entryName)
                    ?: error("Required VANTA Android icon is missing from ZIP: $entryName")
                val output = file("src/main/res/$outputPath")
                output.parentFile.mkdirs()
                archive.getInputStream(entry).use { input ->
                    output.outputStream().use { target -> input.copyTo(target) }
                }
            }
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn(installVantaLauncherIcons)
}

android {
    namespace = "com.vanta.app"
    compileSdk = 36

    buildFeatures { buildConfig = true }

    defaultConfig {
        applicationId = "com.vanta.app"
        minSdk = 24
        targetSdk = 36
        versionCode = releaseVersionCode
        versionName = "0.1.$releaseVersionCode"
        buildConfigField("String", "VANTA_ORIGIN", "\"https://vanta-nu.vercel.app\"")
    }

    signingConfigs {
        create("release") {
            if (!releaseKeystorePath.isNullOrBlank()) storeFile = file(releaseKeystorePath)
            storePassword = releaseKeystorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            if (vantaDebugOrigin != null) {
                buildConfigField("String", "VANTA_ORIGIN", "\"$vantaDebugOrigin\"")
            }
        }
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:34.5.0"))
    implementation("com.google.firebase:firebase-messaging")
}
