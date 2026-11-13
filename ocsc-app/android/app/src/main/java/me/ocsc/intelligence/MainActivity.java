package me.ocsc.intelligence;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
