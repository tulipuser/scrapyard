/*
  ====================
  content_script.js
  ====================
*/

function log(logtype, content){
    browser.runtime.sendMessage({type:'LOG', logtype:logtype, content: content});
}

/* clone parent and all of the ancestors to root, return parent */
function cloneParents(p){
    var pp, cc;
    // ... -> HTMLHtmlElement(html) -> HTMLDocument -> null
    while(p){
        var t = p.cloneNode(false);
        if(!cc) cc = t;
        if(pp)t.appendChild(pp);
        pp=t;
        if(p.tagName.toLowerCase() == "html")
            break;
        p = p.parentNode;
    }
    return cc;
}
function lockListener(event){
    event.preventDefault();
    event.returnValue = '';
}
function lock(){
    if(!$("#scrapbee-waiting").length){
	var $cover = $("<div id='scrapbee-waiting'></div>").appendTo(document.body)
	$cover.css({"background-image":"url("+browser.extension.getURL("icons/bee-waiting.svg")+")"})
	window.addEventListener("beforeunload", lockListener);
	return true;
    }
}
function unlock(){
    $("#scrapbee-waiting").remove();
    window.removeEventListener("beforeunload", lockListener);
}
function notifyMe(msg) {
    function Next(){
	var notification = new Notification(msg, {tag:"scrapbee-tag"});
	notification.onshow = function () { 
	    setTimeout(notification.close.bind(notification), 5000); 
	}
    }
    if (!("Notification" in window)) {
	// 
    } else if (Notification.permission === "granted") {
	Next();
    } else if (Notification.permission !== 'denied') {
	Notification.requestPermission(function (permission) {
            if (permission === "granted") {
		Next();
            }
	});
    }
}
/* capture content */
function getContent(sele, callback){
    /** html */
    var selection = window.getSelection();
    var content = null;
    var div = document.createElement("div");
    if(sele){
        // if(selection.rangeCount > 0)
        var range = window.getSelection().getRangeAt(0);
	parentEl = range.commonAncestorContainer;
	var p = cloneParents(parentEl);
	var c = range.cloneContents();
	if(p){
	    div.appendChild(p.getRootNode());
	    p.appendChild(c);
	}else{
	    div.appendChild(c);
	}
	var html = div.firstChild;
	if(html && html.tagName.toLowerCase() == "html"){
	    var heads = document.getElementsByTagName("head");
	    if(heads.length){
		html.insertBefore(heads[0].cloneNode(true), html.firstChild);
	    }
	}
    }else{
	div.appendChild(document.documentElement.cloneNode(true));
    }
    $(div).find("#scrapbee-waiting").remove();
    /** css */
    var css=[]
    for(let sheet of document.styleSheets){
        try{
        var rule = sheet.rules || sheet.cssRules;
        for (let r of rule){
                css.push(r.cssText + "");
	    }
        }catch(e){
	    if(e.name == "SecurityError") {
		try{
		    var request = new XMLHttpRequest();
            request.open('GET', sheet.href, false);  // `false` makes the request synchronous
		    request.send(null);
		    if (request.status === 200) {
			css.push(request.responseText);
		    }
		}catch(e){
		    log("error", e); 
		}
	    }
	}
    }
    /** resources */
    var res = [];
    var dict = {}
    res.push({type:"image", "url": location.origin + "/favicon.ico", filename:"favicon.ico"});
    div.childNodes.iterateAll(function(item){
        if(item.nodeType == 1){
    	    var el = new ScrapbeeElement(item).processResources();
    	    for(let r of el){
    		if(!dict[r.url]){
    		    dict[r.url] = 1;
    		    res.push(r);
    		}
    	    }
        }
    });
    /*** add main css tag */
    var mc = document.createElement("link")
    mc.rel="stylesheet";
    mc.href="index.css";
    mc.media="screen";
    var head = div.getElementsByTagName("head");
    if(head.length){
	head[0].appendChild(mc);
    }
    /*** download resources and callback */
    var result = {html: div.innerHTML.trim(), res:res, css: css.join("\n"), title: document.title};
    var downloaded = 0;
    if(res.length){
	res.forEach(function(r, i){
	    downloadFile(r.url, function(b){
		if(b) r.blob = b;
		if(++downloaded == res.length){
		    callback(result)
		}
	    });
	});
    }else{
	callback(result);
    }
};
/* message listener */
function getAllCssLoaded(){
    var css=[]
    for(let sheet of document.styleSheets){
        try{
            for (let rule of sheet.cssRules){
                css.push(rule.cssText+"");
            }
        }catch(e){}
    }
    return css.join("\n");
}
function getImages(){
    var images=[]
    for(let image of document.images){
        images.push(image.src);
    }
    return images.join("\n");
}
function saveContent(itemId, windowId, content){
    browser.runtime.sendMessage({
        type: 'SAVE_CONTENT',
	content: content,
	itemId: itemId,
	windowId: windowId
    });
}
function wrapSelection(node) {
    // https://bbs.csdn.net/topics/390813174/

    var range = window.getSelection().getRangeAt(0);
    range.surroundContents(node)
    return

    if(range){
        var c = range.cloneContents();
        range.deleteContents();
        var n = c.firstChild;
        var ws=[]
        while(n){
            var w;
            if(n.nodeType==1){
                // w = n;
                // var nn = node.cloneNode()
                // nn.innerHTML = n.innerHTML;
                // n.innerHTML = ""
                // n.appendChild(nn)

                w = node.cloneNode()
                w.innerHTML = n.innerHTML;
                
                // https://developer.mozilla.org/en-US/docs/Web/API/Range
                // Range.insertNode()
                // Range.surroundContents()
                // Range.deleteContents()
                
            }else{
                w = node.cloneNode()
                w.appendChild(c);
            }
            ws.push(w)
            n=n.nextSibling;
        }
        ws.reverse().forEach(function(node){
            range.insertNode(node);
        })
    }
}
browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if(request.type == "GET_PAGE_SELECTION_REQUEST"){
	if(lock()){
    	    getContent(true, function(content){
		saveContent(request.itemId, request.windowId, content)
    	    });
	}
    }else if(request.type == "GET_PAGE_REQUEST"){
	if(lock()){
    	    getContent(false, function(content){
		saveContent(request.itemId, request.windowId, content)
    	    });
	}
    }else if(request.type == "SAVE_CONTENT_FINISHED"){
	// notifyMe("save " + request.title + " finished.");
	unlock();
    } else if(request.type == 'REQUIRE_OPEN_SIDEBAR'){
	alert("Please open ScrapBee in sidebar before the action")
    }
    return false;
});
function isDescendant(parent, child) {
    var node = child;
    while (node != null) {
        if (node == parent) {
            return true;
        }
        node = node.parentNode;
    }
    return false;
}
class EditToolBar{
    constructor(scrap_path){
        var self = this;
        this.scrap_path=scrap_path;
        this.buildTools()
        window.addEventListener("click", function(e){
            if(e.button == 0) {
                if(!isDescendant(self.div, e.target) && self.last && self.editing){
                    e.preventDefault();
                    self.last.parentNode.removeChild(self.last)
                    self.last=null;
                }
                /** hide marker-pen menu when click somewhere */
                if(!$(e.target).hasClass("mark-pen-btn")){
                    e.preventDefault();
                    $(self.menu).hide();
                }
            }
        });
        window.addEventListener("mousemove", function(e){
            if(self.editing){
                var dom = document.elementFromPoint(e.pageX, e.pageY - window.scrollY);
                if(dom && !isDescendant(self.div, dom)){
                    if(self.last)
                        self.last.style.border = self.last_border;
                    self.last_border = dom.style.border;
                    self.last = dom;
                    dom.style.border="2px solid #f00";
                }
            }
        });        
    }
    toggleDomEdit(on){
        var self = this;
        if(self.last)
            self.last.style.border = self.last_border;        
        self.last = null;
        self.last_border = null;
        self.editing = on;
	$(this.div).find("input[type=button]").prop("disabled", on);
        document.body.style.cursor=self.editing?"crosshair":"";
    }
    saveDoc(){
        var self=this;
        var doc = document.documentElement.cloneNode(true)
        $(doc).find(".scrapbee-edit-bar").remove();
        browser.runtime.sendMessage({
            type: 'SAVE_CONTENT2',
	    content: $(doc).html(),
	    path: self.scrap_path,
            title: document.title
        });
    }
    buildTools(){
        var self = this;
	var editing=false;
	/** toolbar */
        $(".scrapbee-edit-bar").remove();
        var div = document.createElement("div");
        div.className = "scrapbee-edit-bar"
        document.body.appendChild(div);
        this.div=div;
	/** icon */
        var img = document.createElement("img");
	img.className="scrapbee-icon"
	var extension_id = browser.i18n.getMessage("@@extension_id"); 
        img.src = `moz-extension://${extension_id}/icons/bee.png`;
	div.appendChild(img);
	div.innerHTML+=" ScrapBee&nbsp;&nbsp;";
        /** body */
        document.body.style.marginBottom="100px";
        document.body.style.paddingLeft="0px";
        document.body.style.marginLeft="0px";
	/** save button */
        var btn = document.createElement("input");
        btn.type="button";
	btn.className="yellow-button"
        btn.value=chrome.i18n.getMessage("save");
        div.appendChild(btn);
        btn.addEventListener("click", function(){
            self.saveDoc();
        });
	/** modify dom button */
        var btn = document.createElement("input");
        btn.type="button";
	btn.className="blue-button"
        btn.value=chrome.i18n.getMessage("MODIFY_DOM_ON");
        div.appendChild(btn);
        btn.addEventListener("click", function(){
            editing=!editing;
            self.toggleDomEdit(editing)
	    this.value=chrome.i18n.getMessage(editing?"MODIFY_DOM_OFF":"MODIFY_DOM_ON");
	    $(this).prop("disabled", false)
        });
	/** mark pen button */
        var btn = document.createElement("input");
        btn.type="button";
	btn.className="blue-button mark-pen-btn"
        btn.value=chrome.i18n.getMessage("MARK_PEN");
        div.appendChild(btn);
        btn.addEventListener("click", function(){
            $(self.menu).toggle()
        });
	/** mark pen menu */
        var rect_btn = btn.getBoundingClientRect();
        var rect_div = this.div.getBoundingClientRect();
        var $m = $("<div>").appendTo(this.div);
        for (let child of ["scrapbee-marker-1", "scrapbee-marker-2", "scrapbee-marker-3", "scrapbee-marker-4"]){
	    
            var $item = $("<div>").appendTo($m).html("").css({
                height:"14px",
                color:"#333",
                cursor:"pointer",
                borderBottom:"1px solid #999",
                padding:"8px 20px",
                verticalAlign:"middle"
            }).bind("mousedown", function(e){
                e.preventDefault()
                mark(child);
            });
            $(`<div class='scrapbee-menu-item ${child}'>Simple Text</div>`).appendTo($item).css({
                height:"14px",
                lineHeight:"14px",
                minWidth:"200px"
            });
        }
        $m.css({
            position: 'absolute',
            zIndex: 2147483647,
            bottom: (rect_div.bottom - rect_btn.top) + "px",
            left: rect_btn.left + "px",
            border: "1px solid #999",
            background: "#fff",
            display: "none",
            boxShadow: "5px 5px 5px #888888",
            borderWidth: "1px 1px 0px 1px"
        });
        this.menu = $m[0];


	/** reload button */
        var btn = document.createElement("input");
        btn.type="button";
	btn.className="blue-button"
        btn.value=chrome.i18n.getMessage("Reload");
        div.appendChild(btn);
        btn.addEventListener("click", function(){
            window.location.reload()
        });
    }
}
var platform = "linux";
if (navigator.platform == "Win64" || navigator.platform == "Win32") {
    platform = "windows";
}else if(/Mac.+/.test(navigator.platform)){
    platform = "mac";
}
$(document).ready(function(){
    if(1 || location.href.match(/\http:\/\/localhost\:\d+\/file-service\/(.+\/data\/\d+\/)\?scrapbee_editing=1$/i)){
        var path = RegExp.$1;
        if(platform!="windows"){
            path = `/${path}`
        }
        new EditToolBar(path);
    }
});
function downloadFile(url, callback){
    try{
	var oReq = new XMLHttpRequest();
	oReq.open("GET", url, true);
	oReq.responseType = "blob";
	oReq.onload = function(oEvent) {
	    if(oReq.response){
		callback(oReq.response);
	    }else{
		callback(false);
	    } 
	};
	oReq.onerror=function(e){
	    callback(false);
	}
	oReq.send();
    }catch(e){
	log("error", `download file error, ${e}`)
	callback(false);
    }
}
console.log("[content_script.js] loaded")