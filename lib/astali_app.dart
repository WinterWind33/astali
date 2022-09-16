// Copyright (C) 2022 Andrea Ballestrazzi
import 'package:flutter/material.dart';

import 'astali_injector.dart';
import 'astali_app_home.dart';

class AstaliApp extends StatelessWidget {
  const AstaliApp(AstaliInjector injector, {super.key})
      : mainInjector = injector;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(title: 'Astali', home: AstaliAppHome(mainInjector));
  }

  final AstaliInjector mainInjector;
}
