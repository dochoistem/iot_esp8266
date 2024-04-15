//% color=#ed7b00 icon="\uf1eb"
namespace DoChoiSTEM {
    	let wifi_connected: boolean = false
    	let thingspeak_connected: boolean = false
    	let thingspeak_upload:boolean = false
    	let internetTimeInitialized = false
	let internetTimeUpdated = false
	let year = 0, month = 0, day = 0, weekday = 0, hour = 0, minute = 0, second = 0
    	const EVENT_ON_ID = 100
    	const EVENT_ON_Value = 200
    	const EVENT_OFF_ID = 110
    	const EVENT_OFF_Value = 210
	const NTP_SERVER_URL = "pool.ntp.org"
	const mqttSubscribeHandlers: { [topic: string]: (message: string) => void } = {}
    	let toSendStr = ""
    	let httpGetCmd = ""
	let rxData = ""
	let recvString = ""
    	
    export enum State {
        //% block="Success"
        Success,
        //% block="Fail"
        Fail
    }

    enum HttpMethod {
        GET,
        POST,
        PUT,
        HEAD,
        DELETE,
        PATCH,
        OPTIONS,
        CONNECT,
        TRACE
    }

    enum Newline {
        CRLF,
        LF,
        CR
    }

    export enum DHT11Type {
        //% block="temperature(℃)" enumval=0
        DHT11_temperature_C,

        //% block="temperature(℉)" enumval=1
        DHT11_temperature_F,

        //% block="humidity(0~100)" enumval=2
        DHT11_humidity,
    }

    // write AT command with CR+LF ending
    function sendAT(command: string, wait: number = 0) {
        serial.writeString(command + "\u000D\u000A")
        basic.pause(wait)
    }

    export function sendCommand(command: string, expected_response: string = null, timeout: number = 100): boolean {
        // Wait a while from previous command.
        basic.pause(10)
        // Flush the Rx buffer.
        serial.readString()
        rxData = ""
        // Send the command and end with "\r\n".
        serial.writeString(command + "\r\n")        
        // Don't check if expected response is not specified.
        if (expected_response == null) {
            return true
        }        
        // Wait and verify the response.
        let result = false
        let timestamp = input.runningTime()
        while (true) {
            // Timeout.
            if (input.runningTime() - timestamp > timeout) {
                result = false
                break
            }
            // Read until the end of the line.
            rxData += serial.readString()
            if (rxData.includes("\r\n")) {
                // Check if expected response received.
                if (rxData.slice(0, rxData.indexOf("\r\n")).includes(expected_response)) {
                    result = true
                    break
                }
                // If we expected "OK" but "ERROR" is received, do not wait for timeout.
                if (expected_response == "OK") {
                    if (rxData.slice(0, rxData.indexOf("\r\n")).includes("ERROR")) {
                        result = false
                        break
                    }
                }
                // Trim the Rx data before loop again.
                rxData = rxData.slice(rxData.indexOf("\r\n") + 2)
            }
        }
        return result
    }

    export function getResponse(response: string, timeout: number = 100): string {
        let responseLine = ""
        let timestamp = input.runningTime()
        while (true) {
            // Timeout.
            if (input.runningTime() - timestamp > timeout) {
                // Check if expected response received in case no CRLF received.
                if (rxData.includes(response)) {
                    responseLine = rxData
                }
                break
            }
            // Read until the end of the line.
            rxData += serial.readString()
            if (rxData.includes("\r\n")) {
                // Check if expected response received.
                if (rxData.slice(0, rxData.indexOf("\r\n")).includes(response)) {
                    responseLine = rxData.slice(0, rxData.indexOf("\r\n"))
                    // Trim the Rx data for next call.
                    rxData = rxData.slice(rxData.indexOf("\r\n") + 2)
                    break
                }
                // Trim the Rx data before loop again.
                rxData = rxData.slice(rxData.indexOf("\r\n") + 2)
            }
        }
        return responseLine
    }

    /*----------------------------------ESP8266-----------------------*/
    /**
     * Initialize ESP8266 module
     */
    //% block="Init ESP8266|RX %tx|TX %rx|Baud rate %baudrate"
    //% group=ESP8266
    //% tx.defl=SerialPin.P8
    //% rx.defl=SerialPin.P2
    //% weight=100
    export function initWIFI(tx: SerialPin, rx: SerialPin, baudrate: BaudRate) {
        serial.redirect(tx,rx,baudrate)
        sendAT("AT+RESTORE", 1000) 	// restore to factory settings
	sendAT("ATE0", 500) 		// disable copy reply
        sendAT("AT+CWMODE=1") 		// set to STA mode
        basic.pause(1000)
    }

    /**
    * connect to Wifi router
    */
    //% block="Connect Wifi SSID = %ssid|KEY = %pw"
    //% group=ESP8266
    //% ssid.defl=your_ssid
    //% pw.defl=your_pwd 
    //% weight=95
    export function connectWifi(ssid: string, pw: string) {
	wifi_connected = false
        thingspeak_connected = false
        sendAT("AT+CWJAP=\"" + ssid + "\",\"" + pw + "\"", 200) // connect to Wifi router
	let serial_str: string = ""
        let time: number = input.runningTime()
	while (true) {
		if (input.runningTime() - time <= 10000){
			serial_str += serial.readString()
			if (serial_str.includes("OK")) {
                		serial_str=""
            		}
			else if (serial_str.includes("FAIL")) {
                		serial_str=""
                		break
            		}
			else if (serial_str.includes("WIFI CONNECTED")){
				serial_str=""
                		wifi_connected = true
                		break
		
			}
			else if (serial_str.length > 30)
                		serial_str = serial_str.slice(serial_str.length - 15)
		}
            	else {
                	break
		}
	}
    }

    /**
    * Check if ESP8266 successfully connected to Wifi
    */
    //% block="Wifi Connected= %State?"
    //% group="ESP8266"
    //% weight=90
    export function wifiState(state: boolean) {
        if (wifi_connected == state) {
            return true
        }
        else {
            return false
        }
    }
	
    /*----------------------------------ThingSpeak-----------------------*
    /**
     * Connect to ThingSpeak
     */
    //% block="Connect to ThingSpeak"
    //% subcategory="ThingSpeak" weight=85
    //% write_api_key.defl=your_write_api_key
    export function connectThingSpeak() {		
		// Reset the flags.
        	thingspeak_connected = false
        	// Make sure the WiFi is connected.
        	if (wifi_connected == false) return
        	// Enable the ThingSpeak TCP. Return if failed.
		let text_command = "AT+CIPSTART=\"TCP\",\"api.thingspeak.com\",80"
        	if (sendCommand(text_command, "OK", 500) == false) return        	
		thingspeak_connected = true
        	return		
    }

    /**
    * Check if ESP8266 successfully connected to ThingSpeak
    */
    //% block="ThingSpeak Connected=%State?" 
    //% subcategory="ThingSpeak" weight=80
    export function thingSpeakState(state: boolean) {
        if (thingspeak_connected == state) {
            return true
        }
        else {
            return false
        }
    }

    /**
    * Connect to ThingSpeak and set data. 
    */
    //% block="Setup ThingSpeak Data | Write API key = %write_api_key|Field 1 = %n1||Field 2 = %n2|Field 3 = %n3|Field 4 = %n4|Field 5 = %n5|Field 6 = %n6|Field 7 = %n7|Field 8 = %n8"
    //% subcategory="ThingSpeak" weight=75
    //% write_api_key.defl=API_Key
    //% expandableArgumentMode="enabled"
    export function setData(write_api_key: string, n1: number = 0, n2: number = 0, n3: number = 0, n4: number = 0, n5: number = 0, n6: number = 0, n7: number = 0, n8: number = 0) {
        toSendStr = "GET /update?api_key="
            + write_api_key
            + "&field1="
            + n1
            + "&field2="
            + n2
            + "&field3="
            + n3
            + "&field4="
            + n4
            + "&field5="
            + n5
            + "&field6="
            + n6
            + "&field7="
            + n7
            + "&field8="
            + n8        
    }


    /**
    * upload data. It would not upload anything if it failed to connect to Wifi or ThingSpeak.
    */
    //% block="Send data to ThingSpeak"
    //% subcategory="ThingSpeak" weight=70
    export function uploadData() {
        thingspeak_upload = false
	if (thingspeak_connected) {
            	// Define the length of the data
		sendAT("AT+CIPSEND=" + (toSendStr.length + 2), 100)            
            	basic.pause(200)
		thingspeak_upload = false
		// Start to send
		sendAT(toSendStr, 100) // upload data
		let serial_str: string = ""
            	let time: number = input.runningTime()	    
		while (true) {
			if (input.runningTime() - time <= 4000){
				serial_str += serial.readString()
				if (serial_str.includes("SEND OK")) {
                    			serial_str=""
					thingspeak_upload = true
					break			
            			}
				else if (serial_str.includes("ERROR")) {
                			serial_str=""
                			break
            			}
				else if (serial_str.length > 30)
                			serial_str = serial_str.slice(serial_str.length - 15)
			}
            		else
                		break
		}
	}
    }

    /**
    * Check if Thingspeak upload successfully
    */
    //% block="Upload ThingSpeak Successful= %State?"
    //% subcategory="ThingSpeak" weight=69
    export function uploadThingSpeakState(state: boolean) {
        if (thingspeak_upload == state) {
            return true
        }
        else {
            return false
        }
    }    

    /*----------------------------------MQTT-----------------------*/
    /*
     * Set  MQTT client
     */
    //% block="Config User MQTT | Scheme: %scheme|Client: %clientid||Username: %username|Password: %clientPwd|Path: %path"
    //% subcategory="MQTT" weight=65
    //% expandableArgumentMode="enabled"
    //% scheme.defl=0
    //% clientID.defl=microbit
    export function mqtt_user_config(scheme: number, clientID: string, username: string, clientPWD: string, path:string): void {
	toSendStr = "AT+MQTTUSERCFG=0," + scheme + ",\"" + clientID + "\","
	if (username == "") {
            toSendStr += ","
        }
        else {
            toSendStr += "\"" + username +"\","
        }
	if (clientPWD == "") {
            toSendStr += ","
        }
        else {
            toSendStr += "\"" + clientPWD +"\","
        }
	toSendStr += "0,0,\"" + path + "\""
	sendAT(toSendStr, 200) 
	//sendAT("AT+MQTTUSERCFG=0,0,\"microbit\",,,0,0,\"\"",200)	
    }

    /*
     * Connect to MQTT broker
     */
    //% block="Connect MQTT |Server: %serverIp|Port: %serverPort|Reconnect: %reconnect"
    //% subcategory="MQTT" weight=60
    //% serverIP.defl=broker.hivemq.com
    //% serverPort.defl=1883
    export function mqtt_connect(serverIP: string, serverPort: number, reconnect: number): void {		
	sendAT("AT+MQTTCLEAN=0",1000)
	sendAT("AT+MQTTCONN=0,\"" + serverIP + "\"," + serverPort + "," + reconnect,1000)
	//sendAT("AT+MQTTCONN=0,\"broker.hivemq.com\",1883,0",1000)
    }

     /*
     * MQTT Publish
     */
    //% block="Publish MQTT | Topic: %topicname | Data: %data | QoS: %qos"
    //% subcategory="MQTT" weight=55
    //% topicName.defl=microbit-send
    //% datagram.defl=100
    //% qos.defl=2
    export function mqtt_publish(topicName: string, datagram: string, qos: number): void {
	//sendAT("AT+MQTTPUB=0,\"microbit-send\",\"100\",2,0",200)
	sendAT("AT+MQTTPUB=0,\"" + topicName + "\",\"" + datagram + "\"," + qos + ",0",200)
    }


    /**
     * Set MQTT subscribe
    */
    //% block="MQTT Subscribe Topic: %topicname | QOS %qos"
    //% subcategory="MQTT" weight=50
    //% topicName.defl=microbit-send
    //% qos.defl=2
    export function mqtt_subscribe(topicName: string, qos: number): void {        
        toSendStr = "AT+MQTTSUB=0,\"" + topicName + "\"," + qos + "\""
	sendAT(toSendStr,500);	
    }

    /**
     * When topic subcribed has data
    */
    //% block="MQTT Topic: %topic have new "
    //% subcategory="MQTT" weight=45
    //% draggableParameters
    //% topic.defl=microbit-send
    export function MqttEvent(topic: string, handler: (message: string) => void) {
	mqttSubscribeHandlers[topic] = handler
    }
 
    /*************************
     * on serial received data
     *************************/
    serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function() {
	recvString += serial.readString()
	if (recvString.includes("MQTTSUBRECV")) {
            	recvString = recvString.slice(0, recvString.length-2)
		recvString = recvString.slice(recvString.indexOf("MQTTSUBRECV")+12)
            	const recvStringSplit = recvString.split(",", 2)
            	const topic = recvStringSplit[0]
            	const message = recvStringSplit[1]
            	mqttSubscribeHandlers[topic] && mqttSubscribeHandlers[topic](message)
            	recvString = ""
        }
	else if (recvString.length > 30)
		recvString = recvString.slice(15)
    })

    /*----------------------------------Time-----------------------*/	
    /**
     * Return the year.
     */
	//% block="year"
	//% subcategory="Internet Time" weight=40 blockGap=8 
    	export function getYear(): number {
        	return year
    	}

    /**
     * Return the month.
     */
	//% block="month"    	
	//% subcategory="Internet Time" weight=39 blockGap=8   
    	export function getMonth(): number {
        	return month
    	}

    /**
     * Return the day.
     */
	//% block="day"    	
	//% subcategory="Internet Time" weight=38 blockGap=8 
    	export function getDay(): number {
        	return day
    	}

    /**
     * Return the day of week.
     */
	//% block="day of week"    
	//% subcategory="Internet Time" weight=37 blockGap=8 
    	export function getWeekday(): number {
        	return weekday
    	}

    /**
     * Return the hour.
     */
    	//% block="hour"
	//% subcategory="Internet Time" weight=36 blockGap=8
    	export function getHour(): number {
        	return hour
    	}

    /**
     * Return the minute.
     */
    	//% block="minute"    	
	//% subcategory="Internet Time" weight=35 blockGap=8 
    	export function getMinute(): number {
        	return minute
    	}

    /**
     * Return the second.
     */
	//% block="second"    
	//% subcategory="Internet Time" weight=34 blockGap=8 
    	export function getSecond(): number {
        	return second
    	}

    /**
     * Return true if the internet time is initialzed successfully.
     */
	//% block="internet time initialized"    
	//% subcategory="Internet Time" weight=33 blockGap=12
    	export function isInternetTimeInitialized(): boolean {
        	return internetTimeInitialized
    	}


    /**
     * Initialize the internet time.
     * @param timezone Timezone. eg: 8
     */
	//% block="initialize internet time at timezone %timezone"
    	//% subcategory="Internet Time" weight=32 blockGap=12
    	//% timezone.min=-11 timezone.max=13
    	export function initInternetTime(timezone: number) {
        	// Reset the flags.
        	internetTimeInitialized = false
        	internetTimeUpdated = false
        	// Make sure the WiFi is connected.
        	if (wifi_connected == false) return
        	// Enable the SNTP and set the timezone. Return if failed.
        	if (sendCommand("AT+CIPSNTPCFG=1," + timezone + ",\"" + NTP_SERVER_URL + "\"", "OK", 500) == false) return
        	
		internetTimeInitialized = true
        	return
    	}

    /**
     * Return true if the internet time is updated successfully.
     */
	//% block="internet time updated"    
	//% subcategory="Internet Time" weight=31 blockGap=16    
    	export function isInternetTimeUpdated(): boolean {
        	return internetTimeUpdated
    	}

    /**
     * Update the internet time.
     * @param timezone Timezone. eg: 8
     */
	//% block="update internet time"
    	//% subcategory="Internet Time" weight=30 blockGap=16 
    	export function updateInternetTime() {
        	// Reset the flag.
        	internetTimeUpdated = false
        	// Make sure the WiFi is connected.
        	if (wifi_connected == false) return
        	// Make sure it's initialized.
        	if (internetTimeInitialized == false) return
        	// Wait until we get a valid time update.
        	let responseArray
        	let timestamp = input.runningTime()
        	while (true) {
            		// Timeout after 10 seconds.
            		if (input.runningTime() - timestamp > 20000) {
                		return
            		}

            		// Get the time.
            		sendCommand("AT+CIPSNTPTIME?")
            		let response = getResponse("+CIPSNTPTIME:", 2000)
            		if (response == "") return

            		// Fill up the time and date accordingly.
            		response = response.slice(response.indexOf(":") + 1)
            		responseArray = response.split(" ")

            		// Remove the preceeding " " for each field.
            		while (responseArray.removeElement(""));

            		// If the year is still 1970, means it's not updated yet.
            		if (responseArray[4] != "1970") {
               			break
            		}
            		basic.pause(100)
        	}

        	// Day of week.
        	switch (responseArray[0]) {
            		case "Mon": weekday = 1; break
		        case "Tue": weekday = 2; break
        		case "Wed": weekday = 3; break
            		case "Thu": weekday = 4; break
	            	case "Fri": weekday = 5; break
        	    	case "Sat": weekday = 6; break
            		case "Sun": weekday = 7; break
        	}

        	// Month.
        	switch (responseArray[1]) {
            		case "Jan": month = 1; break
            		case "Feb": month = 2; break
            		case "Mar": month = 3; break
            		case "Apr": month = 4; break
            		case "May": month = 5; break
            		case "Jun": month = 6; break
            		case "Jul": month = 7; break
            		case "Aug": month = 8; break
            		case "Sep": month = 9; break
            		case "Oct": month = 10; break
            		case "Nov": month = 11; break
            		case "Dec": month = 12; break
        	}

        	// Day.
        	day = parseInt(responseArray[2])

        	// Time.
        	let timeArray = responseArray[3].split(":")
        	hour = parseInt(timeArray[0])
        	minute = parseInt(timeArray[1])
        	second = parseInt(timeArray[2])

        	// Year.
        	year = parseInt(responseArray[4])

        	// Wait until OK is received.
        	if (getResponse("OK") == "") return
        	internetTimeUpdated = true
        	return
	}

    let dht11Humidity = 0
    let dht11Temperature = 0

    /**
     * get dht11 temperature and humidity Value
     * @param dht11pin describe parameter here, eg: DigitalPin.P15
     */
    //% advanced=true
    //% blockId="readdht11" block="value of dht11 %dht11type| at pin %dht11pin"
    //% subcategory="Sensor" weight=20
    export function dht11value(dht11type: DHT11Type, dht11pin: DigitalPin): number {
        const DHT11_TIMEOUT = 100
        const buffer = pins.createBuffer(40)
        const data = [0, 0, 0, 0, 0]
        let startTime = control.micros()

        if (control.hardwareVersion().slice(0, 1) !== '1') { // V2
            // TODO: V2 bug
            pins.digitalReadPin(DigitalPin.P0);
            pins.digitalReadPin(DigitalPin.P1);
            pins.digitalReadPin(DigitalPin.P2);
            pins.digitalReadPin(DigitalPin.P3);
            pins.digitalReadPin(DigitalPin.P4);
            pins.digitalReadPin(DigitalPin.P10);

            // 1.start signal
            pins.digitalWritePin(dht11pin, 0)
            basic.pause(18)

            // 2.pull up and wait 40us
            pins.setPull(dht11pin, PinPullMode.PullUp)
            pins.digitalReadPin(dht11pin)
            control.waitMicros(40)

            // 3.read data
            startTime = control.micros()
            while (pins.digitalReadPin(dht11pin) === 0) {
                if (control.micros() - startTime > DHT11_TIMEOUT) break
            }
            startTime = control.micros()
            while (pins.digitalReadPin(dht11pin) === 1) {
                if (control.micros() - startTime > DHT11_TIMEOUT) break
            }

            for (let dataBits = 0; dataBits < 40; dataBits++) {
                startTime = control.micros()
                while (pins.digitalReadPin(dht11pin) === 1) {
                    if (control.micros() - startTime > DHT11_TIMEOUT) break
                }
                startTime = control.micros()
                while (pins.digitalReadPin(dht11pin) === 0) {
                    if (control.micros() - startTime > DHT11_TIMEOUT) break
                }
                control.waitMicros(28)
                if (pins.digitalReadPin(dht11pin) === 1) {
                    buffer[dataBits] = 1
                }
            }
        } else { // V1
            // 1.start signal
            pins.digitalWritePin(dht11pin, 0)
            basic.pause(18)

            // 2.pull up and wait 40us
            pins.setPull(dht11pin, PinPullMode.PullUp)
            pins.digitalReadPin(dht11pin)
            control.waitMicros(40)

            // 3.read data
            if (pins.digitalReadPin(dht11pin) === 0) {
                while (pins.digitalReadPin(dht11pin) === 0);
                while (pins.digitalReadPin(dht11pin) === 1);

                for (let dataBits = 0; dataBits < 40; dataBits++) {
                    while (pins.digitalReadPin(dht11pin) === 1);
                    while (pins.digitalReadPin(dht11pin) === 0);
                    control.waitMicros(28)
                    if (pins.digitalReadPin(dht11pin) === 1) {
                        buffer[dataBits] = 1
                    }
                }
            }
        }

        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 8; j++) {
                if (buffer[8 * i + j] === 1) {
                    data[i] += 2 ** (7 - j)
                }
            }
        }

        if (((data[0] + data[1] + data[2] + data[3]) & 0xff) === data[4]) {
            dht11Humidity = data[0] + data[1] * 0.1
            dht11Temperature = data[2] + data[3] * 0.1
        }

        switch (dht11type) {
            case DHT11Type.DHT11_temperature_C:
                return dht11Temperature
            case DHT11Type.DHT11_temperature_F:
                return (dht11Temperature * 1.8) + 32
            case DHT11Type.DHT11_humidity:
                return dht11Humidity
        }
    }
}