# 📻 Đài Học Tập Thông Minh cho Bé (iPhone SE + Vỏ In 3D + Web App)

Dự án biến chiếc **iPhone SE (thế hệ 2 / 3 — 2020/2022)** thành một chiếc **đài radio học tập để bàn** hoàn chỉnh, đóng gói kín an toàn cho bé, có nút bấm vật lý đồng bộ với iPhone và giao diện Web App khớp chính xác từng milimet với các ô khoét trên vỏ in 3D.

---

## 1. Bộ file In 3D (`cad/output/`)

Kích thước khoang máy (`138.8 × 67.7 mm`), vị trí nút Âm lượng, nút Nguồn, cổng sạc Lightning và loa đáy được trích xuất trực tiếp từ file gốc `export.3mf`.

| File | Mô tả | Ghi chú in 3D |
| --- | --- | --- |
| `iphone_se_radio_all_parts.3mf` | **File tổng hợp mở thẳng bằng Bambu Studio** (đã xếp sẵn cả 5 chi tiết trên 1 bàn in) | **Không cần Support** |
| `01_front_body.stl` | Thân đài mặt trước (`157 × 80 × 19 mm`): che kín nút Home & viền, khoét 1 cửa sổ màn hình + 4 ô bấm cảm ứng vát 45°, loa kèn dẫn âm hướng ra mặt trước, lỗ sạc Lightning cạnh trái | Đặt mặt trước úp xuống bàn in (`Z = 0`), 0% support |
| `02_back_cover.stl` | Nắp lưng khớp gài (Snap-fit, không cần ốc vít): 4 ngàm đàn hồi chống bé tự mở, gân giữ máy sát mặt kính (tránh lồi camera), khe tản nhiệt | Đặt mặt lưng phẳng xuống bàn in, 0% support |
| `03_button_vol_minus.stl` | Nút cứng **Giảm âm lượng (`−`)** có gờ nổi phân biệt bằng tay & vành chống rơi | In đứng, mặt bích úp bàn in |
| `04_button_vol_plus.stl` | Nút cứng **Tăng âm lượng (`+`)** có dấu cộng nổi & vành chống rơi | In đứng, mặt bích úp bàn in |
| `05_button_power.stl` | Nút cứng **Nguồn** thụt âm mặt đáy (tránh bé bấm nhầm khi đặt bàn, phụ huynh vẫn nhấn được) | In đứng, mặt bích úp bàn in |

### Khuyến nghị thông số in (Bambu Studio)
- **Nhựa**: PLA+ hoặc PETG (PETG giúp 4 ngàm snap-fit dẻo dai, tháo lắp nhiều lần rất bền).
- **Layer height**: `0.20 mm`, **Wall loops**: `3`, **Infill**: `15%–20% Gyroid`.
- **Support**: **TẮT (None)** — mọi chi tiết đã được tối ưu in phẳng không cần support.

### Thứ tự lắp ráp
1. Đặt úp `01_front_body` xuống bàn (mặt khoang máy hướng lên trên).
2. Thả 3 nút bấm vào đúng rãnh từ bên trong: `03_button_vol_minus` (cạnh trên, bên trái), `04_button_vol_plus` (cạnh trên, bên phải), `05_button_power` (cạnh dưới). Vành nút sẽ giữ nút không bị rơi ra ngoài.
3. Mở Web App trên iPhone SE (xem mục 2), xoay ngang sao cho **nút Âm lượng ở cạnh trên**, **nút Home & cổng sạc ở cạnh trái**, rồi đặt máy úp màn hình vào khoang.
4. Đặt `02_back_cover` khớp viền rồi ấn nhẹ đều 4 góc cho đến khi nghe tiếng **tách** (4 ngàm khóa vào rãnh). Khi phụ huynh cần mở hộp, dùng đồng xu hoặc tua-vít dẹt nạy nhẹ tại khe mở ở cạnh trên mặt sau.

---

## 2. Web App Đài Học Tập (`webapp/`)

### Chạy thử ngay trên máy tính hoặc mạng Wi-Fi nội bộ
```bash
cd webapp
python3 -m http.server 8080
```
- Mở trên máy tính: `http://localhost:8080` (sẽ hiện **mô phỏng vỏ đài in 3D** đầy đủ loa & nút bấm để bạn xem trước và biên tập danh sách bài học).
- Mở trên iPhone SE (cùng Wi-Fi): `http://<IP-máy-Mac>:8080` (hoặc đưa thư mục `webapp/` lên **GitHub Pages / Netlify / Cloudflare Pages** miễn phí để dùng mọi lúc không cần bật máy tính).

### Cài đặt chế độ Đài Kín trên iPhone SE (Rất quan trọng!)
1. Mở trang Web App trên **Safari** của iPhone SE.
2. Nhấn nút **Chia sẻ (Share)** → chọn **Thêm vào Màn hình chính (Add to Home Screen)** → mở app từ biểu tượng **Đài Của Bé** trên màn hình chính để chạy **toàn màn hình 100%** (ẩn hoàn toàn thanh địa chỉ Safari, khớp chuẩn từng milimet với vỏ in 3D).
3. Vào **Cài đặt iPhone → Trợ năng (Accessibility) → Truy cập được hướng dẫn (Guided Access)** và bật lên.
4. Mở app **Đài Của Bé**, xoay ngang máy, nhấn **3 lần nút Home** → chọn **Bắt đầu (Start)** để khóa chặt iPhone trong ứng dụng đài (bé không thể thoát app, không bị thông báo làm phiền).

### Cách sử dụng cho Bé & Phụ huynh
- **4 nút cảm ứng của bé**: `⏮ TRƯỚC` | `▶ PHÁT / ⏸ DỪNG` | `⏭ TIẾP` | `📻 KÊNH`.
- **Mở Khu vực Phụ huynh**: **Giữ lì nút `📻 KÊNH` trong 2.5 giây** → nhập mã PIN (mặc định **`1234`**).
- Trong khu vực Phụ huynh, bạn có thể:
  - Dán bất kỳ link YouTube nào vào từng kênh học (Tiếng Anh, Kể chuyện, Nhạc thiếu nhi...).
  - Chuyển giữa **Chế độ Chỉ hiện Đài Radio** (mặc định, bảo vệ mắt bé) hoặc **Khung Video nhỏ**.
  - Bật **Hẹn giờ tự động tắt đài** (15 / 30 / 45 / 60 phút).
  - Bật **Lưới căn chỉnh 3D** và tinh chỉnh nhẹ độ lệch X/Y nếu cần.
