import json
p='src/i18n/translations.json';d=json.load(open(p))
rows={
'Chat colors':['ჩატის ფერები','Цвета чата'],'Default':['ძირითადი','По умолчанию'],'White':['თეთრი','Белый'],'Blue':['ლურჯი','Синий'],'Delete':['წაშლა','Удалить'],
'First name':['სახელი','Имя'],'Last name':['გვარი','Фамилия'],'IP address':['IP მისამართი','IP-адрес'],'Checking…':['მოწმდება…','Проверка…'],'Unavailable offline':['კავშირის გარეშე მიუწვდომელია','Недоступно без интернета'],
'Save profile':['პროფილის შენახვა','Сохранить профиль'],'Profile saved.':['პროფილი შენახულია.','Профиль сохранён.'],'Delete Profile':['პროფილის წაშლა','Удалить профиль'],
'Delete your profile permanently?':['წავშალოთ პროფილი სამუდამოდ?','Удалить профиль навсегда?'],
'Your profile and chat history will be permanently deleted. All Birdoff settings, saved API keys and downloaded files on this device will also be cleared, including shared AI and translation packs. This cannot be undone. Other local accounts will remain. Files you saved outside the app are not affected.':['თქვენი პროფილი და ჩატის ისტორია სამუდამოდ წაიშლება. ამ მოწყობილობაზე ასევე გასუფთავდება Birdoff-ის ყველა პარამეტრი, შენახული API გასაღები და ჩამოტვირთული ფაილი, მათ შორის საერთო AI მოდელები და თარგმანის პაკეტი. აღდგენა შეუძლებელია. სხვა ლოკალური ანგარიშები დარჩება. აპის გარეთ შენახული ფაილები არ წაიშლება.','Ваш профиль и история чатов будут удалены навсегда. Все настройки Birdoff, сохранённые API-ключи и загруженные файлы на этом устройстве, включая общие модели ИИ и пакет перевода, также будут удалены. Отменить это нельзя. Другие локальные аккаунты сохранятся. Файлы вне приложения не затрагиваются.'],
'IP shows your current internet connection, when available. It is not saved to your profile.':['IP აჩვენებს მიმდინარე ინტერნეტკავშირის მისამართს, როცა ის ხელმისაწვდომია. პროფილში არ ინახება.','IP показывает адрес текущего интернет-соединения, если он доступен. Он не сохраняется в профиле.'],
'The operation could not be completed. Please try again.':['მოქმედება ვერ დასრულდა. სცადეთ ხელახლა.','Не удалось завершить действие. Повторите попытку.'],
'Think, write and translate with Birdoff. Chat with downloaded AI models without internet, or connect your own API key for online chat and voice. Find models and language packs in AI Lab.':['Birdoff დაგეხმარებათ იდეების განვითარებაში, წერასა და თარგმანში. ჩამოტვირთულ AI მოდელებს ინტერნეტის გარეშე ესაუბრეთ, ან შეიყვანეთ თქვენი API გასაღები ონლაინ ჩატისა და ხმოვანი საუბრისთვის. მოდელები და ენის პაკეტები AI Lab-შია.','Развивайте идеи, пишите и переводите с Birdoff. Общайтесь со скачанными моделями ИИ без интернета или подключите свой API-ключ для онлайн-чата и голосовых разговоров. Модели и языковые пакеты — в AI Lab.'],
'A little space for bigger ideas.':['პატარა სივრცე დიდი იდეებისთვის.','Небольшое пространство для больших идей.'],
'Birdoff helps you explore ideas, write, translate and talk with AI. Download models in AI Lab to work without internet, or connect your own API key for online conversations.':['Birdoff დაგეხმარებათ იდეების განვითარებაში, წერაში, თარგმანსა და AI-სთან საუბარში. AI Lab-იდან ჩამოტვირთეთ მოდელები ინტერნეტის გარეშე სამუშაოდ, ან შეიყვანეთ თქვენი API გასაღები ონლაინ საუბრებისთვის.','Birdoff помогает развивать идеи, писать, переводить и общаться с ИИ. Скачайте модели в AI Lab для работы без интернета или подключите свой API-ключ для онлайн-общения.'],
'Your local account keeps chat history on this device. You choose the tools, the model and when to connect.':['ლოკალური ანგარიში ჩატის ისტორიას ამ მოწყობილობაზე ინახავს. თავად ირჩევთ ხელსაწყოებს, მოდელს და ინტერნეტთან დაკავშირების დროს.','Локальный аккаунт хранит историю чатов на этом устройстве. Вы выбираете инструменты, модель и когда подключаться к сети.'],
'Created by':['ავტორი','Автор'],
'Could not delete the translation pack. Please try again.':['თარგმანის პაკეტი ვერ წაიშალა. სცადეთ ხელახლა.','Не удалось удалить пакет перевода. Повторите попытку.'],
'Delete removes the shared English, Georgian and Russian pack from this device.':['წაშლა ამ მოწყობილობიდან ინგლისურის, ქართულისა და რუსულის საერთო პაკეტს წაშლის.','Удаление уберёт с этого устройства общий пакет английского, грузинского и русского языков.']}
d.update(rows)
# No legacy location or old menu labels in translations.
for k,v in d.items():
 d[k]=[s.replace(' — Las Vegas, NV','').replace('საწყობიდან','AI Lab-იდან').replace('საწყობში','AI Lab-ში').replace('საწყობი','AI Lab') for s in v]
open(p,'w').write(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
open('src/i18n/translations.txt','w').write('\n'.join('|'.join([k,*v]) for k,v in d.items())+'\n')
p='src/i18n/keys.json';keys=json.load(open(p));open(p,'w').write(json.dumps(sorted(set(keys)|set(rows)),ensure_ascii=False,indent=2)+'\n')
