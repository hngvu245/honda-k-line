$ErrorActionPreference = 'Stop'

$projDir = $PSScriptRoot
$toolchain = 'D:\kailc\.android-toolchain'
$jdkDir = "$toolchain\jdk"
$sdkDir = "$toolchain\sdk"
$btDir = "$sdkDir\build-tools\34.0.0"
$androidJar = "$sdkDir\platforms\android-34\android.jar"

# Keep all Java & Android caches strictly off drive C:
$env:JAVA_HOME = $jdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_USER_HOME = "$toolchain\android_home"
$env:ANDROID_PREFS_ROOT = "$toolchain\android_home"
$env:TEMP = "$toolchain\tmp"
$env:TMP = "$toolchain\tmp"
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$toolchain\tmp -Duser.home=$toolchain\android_home"
$env:PATH = "$jdkDir\bin;$btDir;$env:PATH"

$buildDir = Join-Path $projDir 'build'
$genDir = Join-Path $buildDir 'gen'
$objDir = Join-Path $buildDir 'obj'
$dexDir = Join-Path $buildDir 'dex'
$resZip = Join-Path $buildDir 'res.zip'
$unsignedApk = Join-Path $buildDir 'unsigned.apk'
$repackedApk = Join-Path $buildDir 'repacked.apk'
$alignedApk = Join-Path $buildDir 'aligned.apk'
$keystore = Join-Path $buildDir 'debug.keystore'
$finalApk = Join-Path $projDir 'honda-kline-racing.apk'

if (Test-Path $buildDir) {
    if (Test-Path $keystore) {
        Copy-Item $keystore "$toolchain\tmp\honda_debug.keystore" -Force
    }
    Remove-Item $buildDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $buildDir, $genDir, $objDir, $dexDir | Out-Null
if (Test-Path "$toolchain\tmp\honda_debug.keystore") {
    Move-Item "$toolchain\tmp\honda_debug.keystore" $keystore -Force
}

Write-Host '[1/6] Compiling Android resources (aapt2)...'
& "$btDir\aapt2.exe" compile --dir (Join-Path $projDir 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '[2/6] Linking manifest & resources (aapt2 link)...'
& "$btDir\aapt2.exe" link `
    -o $unsignedApk `
    -I $androidJar `
    --manifest (Join-Path $projDir 'AndroidManifest.xml') `
    --java $genDir `
    $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '[3/6] Compiling Java sources (javac --release 11)...'
$javaFiles = @(
    Get-ChildItem -Path (Join-Path $projDir 'src') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
    Get-ChildItem -Path $genDir -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
)
& "$jdkDir\bin\javac.exe" --release 11 -encoding UTF-8 -classpath $androidJar -d $objDir @javaFiles
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '[4/6] Dexing bytecode (d8)...'
$classFiles = Get-ChildItem -Path $objDir -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
& "$btDir\d8.bat" --min-api 24 --lib $androidJar --output $dexDir @classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '[5/6] Repacking APK with POSIX forward-slash paths & aligning (zipfile + zipalign)...'
$assetsDir = Join-Path $projDir 'assets'
$dexFile = Join-Path $dexDir 'classes.dex'
python -c "
import os, zipfile

unsigned_apk = r'''$unsignedApk'''
repacked_apk = r'''$repackedApk'''
dex_file = r'''$dexFile'''
assets_dir = r'''$assetsDir'''

with zipfile.ZipFile(unsigned_apk, 'r') as zin, zipfile.ZipFile(repacked_apk, 'w') as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        new_info = zipfile.ZipInfo(item.filename.replace('\\', '/'), date_time=item.date_time)
        new_info.compress_type = item.compress_type
        new_info.external_attr = item.external_attr
        zout.writestr(new_info, data)

    zout.write(dex_file, 'classes.dex', compress_type=zipfile.ZIP_DEFLATED)

    for root, _, files in os.walk(assets_dir):
        for fname in sorted(files):
            full = os.path.join(root, fname)
            rel_posix = os.path.relpath(full, assets_dir).replace('\\', '/')
            arcname = 'assets/' + rel_posix
            ext = os.path.splitext(fname)[1].lower()
            ctype = zipfile.ZIP_STORED if ext in ('.woff2', '.png', '.jpg') else zipfile.ZIP_DEFLATED
            zout.write(full, arcname, compress_type=ctype)
"
if ($LASTEXITCODE -ne 0) { throw 'Python APK repacking failed' }

& "$btDir\zipalign.exe" -f -p 4 $repackedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

Write-Host '[6/6] Signing APK (keytool + apksigner v1+v2+v3)...'
if (-not (Test-Path $keystore)) {
    & "$jdkDir\bin\keytool.exe" -genkeypair -v `
        -keystore $keystore `
        -storepass android -keypass android `
        -alias androiddebugkey `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -dname 'CN=KeihinKLine,OU=Dev,O=Kailc,L=VN,S=VN,C=VN' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

& "$btDir\apksigner.bat" sign `
    --ks $keystore `
    --ks-pass pass:android `
    --key-pass pass:android `
    --ks-key-alias androiddebugkey `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --v3-signing-enabled true `
    --out $finalApk `
    $alignedApk
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

$apkSize = [math]::Round((Get-Item $finalApk).Length / 1KB, 1)
Write-Host "BUILD SUCCESS: $finalApk ($apkSize KB)"
