const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'frontend', 'src', 'lib', 'i18n', 'translations');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf-8'));

const locales = {
  it: { months: ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'], mshort: ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'], days: ['lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica'], dshort: ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'] },
  tr: { months: ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'], mshort: ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'], days: ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'], dshort: ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'] },
  ru: { months: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], mshort: ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'], days: ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'], dshort: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'] },
  hi: { months: ['जनवरी','फरवरी','मार्च','अप्रैल','मई','जून','जुलाई','अगस्त','सितंबर','अक्टूबर','नवंबर','दिसंबर'], mshort: ['जन','फर','मार्च','अप्रै','मई','जून','जुला','अग','सित','अक्टू','नव','दिस'], days: ['सोमवार','मंगलवार','बुधवार','गुरुवार','शुक्रवार','शनिवार','रविवार'], dshort: ['सोम','मंगल','बुध','गुरु','शुक्र','शनि','रवि'] },
  ar: { months: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'], mshort: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'], days: ['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'], dshort: ['إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت','أحد'] },
  ur: { months: ['جنوری','فروری','مارچ','اپریل','مئی','جون','جولائی','اگست','ستمبر','اکتوبر','نومبر','دسمبر'], mshort: ['جنوری','فروری','مارچ','اپریل','مئی','جون','جولائی','اگست','ستمبر','اکتوبر','نومبر','دسمبر'], days: ['پیر','منگل','بدھ','جمعرات','جمعہ','ہفتہ','اتوار'], dshort: ['پیر','منگل','بدھ','جمعرات','جمعہ','ہفتہ','اتوار'] },
  bn: { months: ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'], mshort: ['জান','ফেব্রু','মার্চ','এপ্রি','মে','জুন','জুলাই','আগ','সেপ্ট','অক্টো','নভে','ডিসে'], days: ['সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার','রবিবার'], dshort: ['সোম','মঙ্গল','বুধ','বৃহ','শুক্র','শনি','রবি'] },
  id: { months: ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'], mshort: ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agus','Sep','Okt','Nov','Des'], days: ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'], dshort: ['Sen','Sel','Rab','Kam','Jum','Sab','Min'] },
  vi: { months: ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'], mshort: ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'], days: ['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ Nhật'], dshort: ['T2','T3','T4','T5','T6','T7','CN'] },
  th: { months: ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'], mshort: ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'], days: ['วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์','วันอาทิตย์'], dshort: ['จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์','อาทิตย์'] },
  zh: { months: ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'], mshort: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], days: ['星期一','星期二','星期三','星期四','星期五','星期六','星期日'], dshort: ['周一','周二','周三','周四','周五','周六','周日'] },
  'zh-TW': { months: ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'], mshort: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], days: ['星期一','星期二','星期三','星期四','星期五','星期六','星期日'], dshort: ['週一','週二','週三','週四','週五','週六','週日'] },
  ja: { months: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], mshort: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], days: ['月曜日','火曜日','水曜日','木曜日','金曜日','土曜日','日曜日'], dshort: ['月','火','水','木','金','土','日'] },
  ko: { months: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'], mshort: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'], days: ['월요일','화요일','수요일','목요일','금요일','토요일','일요일'], dshort: ['월','화','수','목','금','토','일'] }
};

const monthKeys = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthShortKeys = ['jan','feb','mar','apr','mayShort','jun','jul','aug','sep','oct','nov','dec'];
const dayKeys = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const dayShortKeys = ['mon','tue','wed','thu','fri','sat','sun'];

for (const [code, l] of Object.entries(locales)) {
  const fp = path.join(dir, `${code}.json`);
  if (fs.existsSync(fp)) { console.log(`Skipping ${code}`); continue; }
  const t = JSON.parse(JSON.stringify(en));
  monthKeys.forEach((k, i) => { t.time[k] = l.months[i]; });
  monthShortKeys.forEach((k, i) => { t.time[k] = l.mshort[i]; });
  dayKeys.forEach((k, i) => { t.time[k] = l.days[i]; });
  dayShortKeys.forEach((k, i) => { t.time[k] = l.dshort[i]; });
  fs.writeFileSync(fp, JSON.stringify(t, null, 2) + '\n');
  console.log(`Created ${code}.json`);
}
console.log('Done!');