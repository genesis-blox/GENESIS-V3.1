# Roblox Account Scanner V2.8

## Fitur baru V2.8
- Creator Overview: ringkasan jumlah community yang diikuti, role Owner yang terdeteksi, experience publik yang dimuat, total visits pada data yang dimuat, dan pemain aktif saat scan.
- Ekspor Laporan Lengkap JSON: menggabungkan informasi akun yang tersedia, item inventory yang sudah dimuat, community, experience publik yang dimuat, dan snapshot inventaris tersimpan untuk akun tersebut.
- Seluruh fitur V2.7 tetap dipertahankan.

## Catatan akurasi dan privasi
- Laporan hanya berisi data publik yang berhasil dimuat; bukan seluruh data Roblox secara otomatis.
- Inventory report hanya mencakup item yang saat itu sudah dimuat.
- Statistik visits/pemain dihitung dari experience yang sudah dimuat, bukan jaminan seluruh katalog kreasi.
- Tidak mengakses data privat dan tidak meminta password, cookie .ROBLOSECURITY, session token, atau kode 2FA.
- Simpan file JSON di tempat aman dan jangan unggah data akun orang lain tanpa izin.

## Instalasi Termux
1. Ekstrak ZIP ke home.
2. `cd ~/roblox-account-scanner-v2.8`
3. `npm install`
4. `npm start`
5. Buka `http://localhost:3000`
