function doPost(e) {
  var body = e && e.postData && e.postData.contents ? e.postData.contents : '';
  Logger.log('LINE webhook raw body: ' + body);

  try {
    var json = JSON.parse(body || '{}');
    var events = json.events || [];
    events.forEach(function(ev, i) {
      var uid = ev && ev.source && ev.source.userId ? ev.source.userId : '';
      Logger.log('event[' + i + '] userId: ' + uid);
    });
  } catch (err) {
    Logger.log('JSON parse error: ' + err);
  }

  // LINEへは200で返す必要あり
  return ContentService.createTextOutput('OK');
}