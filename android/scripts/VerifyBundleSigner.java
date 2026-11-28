import java.io.InputStream;
import java.security.CodeSigner;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** Require every non-signature AAB payload entry to be covered by exactly one expected signer. */
public final class VerifyBundleSigner {
    public static void main(String[] args) throws Exception {
        if (args.length != 2 || !args[1].matches("[a-f0-9]{64}")) {
            throw new IllegalArgumentException("Expected bundle and SHA-256 fingerprint");
        }
        int verified = 0;
        boolean manifest = false;
        boolean bundleConfig = false;
        byte[] buffer = new byte[65536];
        try (JarFile jar = new JarFile(args[0], true)) {
            var entries = jar.entries();
            var names = new java.util.HashSet<String>();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!names.add(entry.getName())) throw new SecurityException("Duplicate bundle entry");
                if (entry.isDirectory()) continue;
                String upper = entry.getName().toUpperCase(Locale.ROOT);
                // Skip only actual JAR signature metadata, not arbitrary META-INF payload.
                if (upper.equals("META-INF/MANIFEST.MF") ||
                    upper.matches("META-INF/[^/]+\\.(SF|RSA|DSA|EC)") ||
                    upper.matches("META-INF/SIG-[^/]+")) continue;
                try (InputStream in = jar.getInputStream(entry)) {
                    while (in.read(buffer) != -1) { /* Reading to EOF triggers verification. */ }
                }
                CodeSigner[] signers = entry.getCodeSigners();
                if (signers == null || signers.length != 1) {
                    throw new SecurityException("Unsigned or multiple-signer bundle payload");
                }
                var cert = signers[0].getSignerCertPath().getCertificates().get(0);
                String fingerprint = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
                if (!fingerprint.equals(args[1])) throw new SecurityException("Unexpected bundle signer");
                verified++;
                manifest |= entry.getName().equals("base/manifest/AndroidManifest.xml");
                bundleConfig |= entry.getName().equals("BundleConfig.pb");
            }
        }
        if (verified == 0 || !manifest || !bundleConfig) throw new SecurityException("Missing required bundle payload");
        System.out.println("Verified signed AAB payload entries: " + verified);
    }
}
