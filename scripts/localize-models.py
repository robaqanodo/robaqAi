import json
p='src/i18n/translations.json'
d=json.load(open(p))
rows={
'Verifying':['მოწმდება','Проверка'],
'Downloading':['იტვირთება','Загрузка'],
'Selected':['არჩეულია','Выбрано'],
'Use':['არჩევა','Выбрать'],
'Remove':['წაშლა','Удалить'],
'Select a model':['აირჩიეთ მოდელი','Выберите модель'],
'Download once, then chat offline. Keep Store open during installation. Start with Qwen3 0.6B on phones.':['ჩამოტვირთეთ ერთხელ და ისაუბრეთ ინტერნეტის გარეშე. ინსტალაციისას საწყობი ღია დატოვეთ. ტელეფონზე დაიწყეთ Qwen3 0.6B-ით.','Скачайте один раз и общайтесь без интернета. Не закрывайте Store во время установки. На телефоне начните с Qwen3 0.6B.'],
'Download a file below, then use the upload arrow beside its model. Files stay on this device.':['ჩამოტვირთეთ ფაილი ქვემოთ, შემდეგ გამოიყენეთ მოდელის გვერდით ატვირთვის ისარი. ფაილები ამ მოწყობილობაზე ინახება.','Скачайте файл ниже и нажмите стрелку загрузки рядом с моделью. Файлы хранятся на этом устройстве.'],
'Incorrect model file size. Download the complete file.':['მოდელის ფაილის ზომა არასწორია. ჩამოტვირთეთ სრული ფაილი.','Неверный размер файла модели. Скачайте полный файл.'],
'Model verification failed. Please download the file again.':['მოდელის შემოწმება ვერ დასრულდა. ხელახლა ჩამოტვირთეთ ფაილი.','Проверка модели не пройдена. Скачайте файл заново.'],
'Please use up to 1,600 characters per offline message.':['offline შეტყობინება არ უნდა აღემატებოდეს 1 600 სიმბოლოს.','Используйте не более 1 600 символов в офлайн-сообщении.'],
'Not enough storage for this model. Free some space and try again.':['მოდელისთვის საკმარისი ადგილი არ არის. გაათავისუფლეთ სივრცე და სცადეთ ხელახლა.','Недостаточно места для модели. Освободите место и повторите.'],
'Download unavailable. Download the linked file and use Manual Submit.':['ჩამოტვირთვა ვერ მოხერხდა. გადმოწერეთ ფაილი ბმულიდან და გამოიყენეთ ხელით ატვირთვა.','Загрузка недоступна. Скачайте файл по ссылке и загрузите вручную.'],
'Incomplete download. Please try again.':['ჩამოტვირთვა არასრულია. სცადეთ ხელახლა.','Загрузка неполная. Повторите попытку.'],
'Model installation failed. Please try again.':['მოდელის ინსტალაცია ვერ მოხერხდა. სცადეთ ხელახლა.','Не удалось установить модель. Повторите попытку.'],
'Could not remove the model. Please try again.':['მოდელი ვერ წაიშალა. სცადეთ ხელახლა.','Не удалось удалить модель. Повторите попытку.'],
'The offline model is still finishing. Please try again shortly.':['offline მოდელი ჯერ მუშაობს. ცოტა ხანში სცადეთ ხელახლა.','Офлайн-модель ещё работает. Повторите немного позже.'],
'This model is not installed. Download it in Store.':['ეს მოდელი დაყენებული არ არის. ჩამოტვირთეთ საწყობიდან.','Модель не установлена. Скачайте её в Store.'],
'This device could not load the model. Try Qwen3 0.6B or close other apps.':['მოწყობილობამ მოდელი ვერ ჩატვირთა. სცადეთ Qwen3 0.6B ან დახურეთ სხვა აპები.','Не удалось загрузить модель на этом устройстве. Попробуйте Qwen3 0.6B или закройте другие приложения.'],
'The model returned no text. Please try a shorter message.':['მოდელმა ტექსტი ვერ დააბრუნა. სცადეთ უფრო მოკლე შეტყობინება.','Модель не вернула текст. Попробуйте более короткое сообщение.'],
'Offline generation failed. Please try again.':['offline პასუხის შექმნა ვერ მოხერხდა. სცადეთ ხელახლა.','Не удалось создать офлайн-ответ. Повторите попытку.']}
d.update(rows)
open(p,'w').write(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
with open('src/i18n/translations.txt','a') as f:
 for key,values in rows.items(): f.write('\n'+ '|'.join([key,*values]))
p='src/i18n/keys.json';keys=json.load(open(p));keys=sorted(set(keys)|set(rows));open(p,'w').write(json.dumps(keys,ensure_ascii=False,indent=2)+'\n')
