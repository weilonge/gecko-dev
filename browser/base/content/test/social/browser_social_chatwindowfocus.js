/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function isChatFocused(chat) {
  return getChatBar()._isChatFocused(chat);
}

function openChatViaSidebarMessage(port, data, callback) {
  port.onmessage = function (e) {
    if (e.data.topic == "chatbox-opened")
      callback();
  }
  port.postMessage({topic: "test-chatbox-open", data: data});
}

function openChatViaWorkerMessage(port, data, callback) {
  // sadly there is no message coming back to tell us when the chat has
  // been opened, so we wait until one appears.
  let chatbar = getChatBar();
  let numExpected = chatbar.childElementCount + 1;
  port.postMessage({topic: "test-worker-chat", data: data});
  waitForCondition(() => chatbar.childElementCount == numExpected,
                   function() {
                      // so the child has been added, but we don't know if it
                      // has been intialized - re-request it and the callback
                      // means it's done.  Minimized, same as the worker.
                      chatbar.openChat({
                        origin: SocialSidebar.provider.origin,
                        title: SocialSidebar.provider.name,
                        url: data,
                        mode: "minimized"
                      }, function() { callback(); });
                   },
                   "No new chat appeared");
}


var isSidebarLoaded = false;

function startTestAndWaitForSidebar(callback) {
  let doneCallback;
  let port = SocialSidebar.provider.getWorkerPort();
  function maybeCallback() {
    if (!doneCallback)
      callback(port);
    doneCallback = true;
  }
  port.onmessage = function(e) {
    let topic = e.data.topic;
    switch (topic) {
      case "got-sidebar-message":
        // if sidebar loaded too fast, we need a backup ping
      case "got-isVisible-response":
        isSidebarLoaded = true;
        maybeCallback();
        break;
      case "test-init-done":
        if (isSidebarLoaded)
          maybeCallback();
        else
          port.postMessage({topic: "test-isVisible"});
        break;
    }
  }
  port.postMessage({topic: "test-init"});
}

var manifest = { // normal provider
  name: "provider 1",
  origin: "https://example.com",
  sidebarURL: "https://example.com/browser/browser/base/content/test/social/social_sidebar.html",
  workerURL: "https://example.com/browser/browser/base/content/test/social/social_worker.js",
  iconURL: "https://example.com/browser/browser/base/content/test/general/moz.png"
};

function test() {
  waitForExplicitFinish();

  // Note that (probably) due to bug 604289, if a tab is focused but the
  // focused element is null, our chat windows can "steal" focus.  This is
  // avoided if we explicitly focus an element in the tab.
  // So we load a page with an <input> field and focus that before testing.
  let url = "data:text/html;charset=utf-8," + encodeURI('<input id="theinput">');
  let tab = gBrowser.selectedTab = gBrowser.addTab(url, {skipAnimation: true});
  let browser = tab.linkedBrowser;
  browser.addEventListener("load", function tabLoad(event) {
    browser.removeEventListener("load", tabLoad, true);
    // before every test we focus the input field.
    let preSubTest = function(cb) {
      ContentTask.spawn(browser, null, function* () {
        content.focus();
        content.document.getElementById("theinput").focus();

        yield ContentTaskUtils.waitForCondition(
          () => Services.focus.focusedWindow == content, "tab should have focus");
      }).then(cb);
    }
    let postSubTest = function(cb) {
      Task.spawn(closeAllChats).then(cb);
    }
    // and run the tests.
    runSocialTestWithProvider(manifest, function (finishcb) {
      SocialSidebar.show();
      runSocialTests(tests, preSubTest, postSubTest, function () {
        finishcb();
      });
    });
  }, true);
  registerCleanupFunction(function() {
    gBrowser.removeTab(tab);
  });

}

var tests = {
  // In this test the worker asks the sidebar to open a chat.  As that means
  // we aren't handling user-input we will not focus the chatbar.
  // Then we do it again - should still not be focused.
  // Then we perform a user-initiated request - it should get focus.
  testNoFocusWhenViaWorker: function(next) {
    let chatbar = getChatBar();
    startTestAndWaitForSidebar(function(port) {
      openChatViaSidebarMessage(port, {stealFocus: 1}, function() {
        ok(true, "got chatbox message");
        is(chatbar.childElementCount, 1, "exactly 1 chat open");

        let browser = gBrowser.selectedTab.linkedBrowser;
        ContentTask.spawn(browser, null, function* () {
          is(Services.focus.focusedWindow, content, "tab should still be focused");
        }).then(() => {
          // re-request the same chat via a message.
          openChatViaSidebarMessage(port, {stealFocus: 1}, function() {
            is(chatbar.childElementCount, 1, "still exactly 1 chat open");

            ContentTask.spawn(browser, null, function* () {
              is(Services.focus.focusedWindow, content, "tab should still be focused");
            }).then(() => {
              // re-request the same chat via user event.
              openChatViaUser();
              waitForCondition(() => isChatFocused(chatbar.selectedChat), function() {
                is(chatbar.childElementCount, 1, "still exactly 1 chat open");
                is(chatbar.selectedChat, chatbar.firstElementChild,
                  "chat should be selected");
                next();
              }, "chat should be focused");
            });
          });
        });
      });
    });
  },

  // In this test we arrange for the sidebar to open the chat via a simulated
  // click.  This should cause the new chat to be opened and focused.
  testFocusWhenViaUser: function(next) {
    startTestAndWaitForSidebar(function(port) {
      let chatbar = getChatBar();
      openChatViaUser();
      ok(chatbar.firstElementChild, "chat opened");
      waitForCondition(() => isChatFocused(chatbar.selectedChat), function() {
        is(chatbar.selectedChat, chatbar.firstElementChild, "chat is selected");
        next();
      }, "chat should be focused");
    });
  },
};
