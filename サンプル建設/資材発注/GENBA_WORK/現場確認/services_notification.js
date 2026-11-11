/**
 * LINEやメールなど通知系をまとめるサービス。
 */
var NotificationService = (function() {

  function sendLineMessage(message) {
    var config = getConfig();
    if (!config.LINE_WEBHOOK_URL) {
      Logger.log('LINE_WEBHOOK_URL is not set. Message: %s', message);
      return;
    }
    var payload = {
      messages: [
        {
          type: 'text',
          text: message
        }
      ]
    };
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(config.LINE_WEBHOOK_URL, options);
    Logger.log('LINE response: %s', response.getContentText());
  }

  /**
   * メール通知を送信する
   * @param {string} to - 送信先メールアドレス
   * @param {string} subject - 件名
   * @param {string} body - 本文
   */
  function sendEmail(to, subject, body) {
    if (!to) {
      Logger.log('メール送信先が未設定です。件名: %s', subject);
      return;
    }
    try {
      MailApp.sendEmail({
        to: to,
        subject: subject,
        body: body
      });
      Logger.log('メール送信成功: %s → %s', subject, to);
    } catch (e) {
      Logger.log('メール送信エラー: %s', e.toString());
    }
  }

  /**
   * 報告提出時に親方へ承認依頼メールを送信する
   * @param {string} approverEmail - 親方のメールアドレス
   * @param {string} siteName - 現場名
   * @param {string} approvalWebAppUrl - 承認WebAppのURL
   */
  function sendSubmissionNotification(approverEmail, siteName, approvalWebAppUrl) {
    var deepLink = approvalWebAppUrl + '?site=' + encodeURIComponent(siteName);
    var subject = '【承認依頼】' + siteName + ' の報告が提出されました';
    var body = siteName + ' の報告が提出されました。\n\n'
      + '以下のリンクから確認・承認をお願いします。\n'
      + deepLink + '\n\n'
      + '---\n'
      + 'サンプル建設 現場管理システム';

    sendEmail(approverEmail, subject, body);
  }

  /**
   * 差し戻し時に提出者へ通知メールを送信する
   * @param {string} submitterEmail - 提出者のメールアドレス
   * @param {string} siteName - 現場名
   * @param {string} comment - 差し戻し理由
   * @param {string} [deadline] - 再提出期限（任意）
   */
  function sendRejectionNotification(submitterEmail, siteName, comment, deadline) {
    var subject = '【差し戻し】' + siteName + ' の報告に不備があります';
    var body = siteName + ' の報告が差し戻されました。\n\n'
      + '【差し戻し理由】\n' + comment + '\n\n';

    if (deadline) {
      body += '【再提出期限】\n' + deadline + '\n\n';
    }

    body += '内容を修正して再提出をお願いします。\n\n'
      + '---\n'
      + 'サンプル建設 現場管理システム';

    sendEmail(submitterEmail, subject, body);
  }

  /**
   * 承認完了時に提出者へ通知メールを送信する
   * @param {string} submitterEmail - 提出者のメールアドレス
   * @param {string} siteName - 現場名
   */
  function sendApprovalNotification(submitterEmail, siteName) {
    var subject = '【承認完了】' + siteName + ' の報告が承認されました';
    var body = siteName + ' の報告が承認されました。\n\n'
      + '承認日時: ' + Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm') + '\n\n'
      + '---\n'
      + 'サンプル建設 現場管理システム';

    sendEmail(submitterEmail, subject, body);
  }

  return {
    sendLineMessage: sendLineMessage,
    sendEmail: sendEmail,
    sendSubmissionNotification: sendSubmissionNotification,
    sendRejectionNotification: sendRejectionNotification,
    sendApprovalNotification: sendApprovalNotification
  };
})();
